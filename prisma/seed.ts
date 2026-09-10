import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ingestDocument } from "@/lib/ai/rag/ingest";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/prisma";
import type {
  ActorType,
  DeliveryStatus,
  OrderStatus,
  PaymentStatus,
  RiskLevel,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from "@/generated/prisma/enums";

/** Everything below is fictional demo data. */
const DEMO_PASSWORD = "FlowPilot!2024";

// Deterministic PRNG so every `db:seed` produces the same demo database.
function mulberry32(seed: number) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20260910);

const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
const between = (min: number, max: number) => Math.floor(random() * (max - min + 1)) + min;

function daysAgo(days: number, hour = 10): Date {
  const date = new Date();
  date.setHours(hour, between(0, 59), between(0, 59), 0);
  date.setDate(date.getDate() - days);
  return date;
}

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setHours(18, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

const USERS = [
  {
    email: "admin@flowpilot.demo",
    name: "Aarav Mehta",
    role: "ADMIN" as const,
    jobTitle: "Head of Operations",
    avatarColor: "#6366f1",
  },
  {
    email: "finance@flowpilot.demo",
    name: "Kabir Anand",
    role: "ADMIN" as const,
    jobTitle: "Finance Manager",
    avatarColor: "#0ea5e9",
  },
  {
    email: "ops@flowpilot.demo",
    name: "Diya Krishnan",
    role: "AGENT" as const,
    jobTitle: "Operations Specialist",
    avatarColor: "#10b981",
  },
  {
    email: "support@flowpilot.demo",
    name: "Rohan Iyer",
    role: "AGENT" as const,
    jobTitle: "Support Lead",
    avatarColor: "#f59e0b",
  },
  {
    email: "viewer@flowpilot.demo",
    name: "Nisha Rao",
    role: "VIEWER" as const,
    jobTitle: "Business Analyst",
    avatarColor: "#ec4899",
  },
];

const CUSTOMERS = [
  { name: "Priya Sharma", company: "Lumen Retail", city: "Bengaluru" },
  { name: "Arjun Nair", company: "Northwind Traders", city: "Kochi" },
  { name: "Meera Iyer", company: "Copperleaf Studios", city: "Chennai" },
  { name: "Rahul Verma", company: "Blueprint Labs", city: "Pune" },
  { name: "Ananya Ghosh", company: "Harbour & Co.", city: "Kolkata" },
  { name: "Vikram Singh", company: "Ironvale Logistics", city: "Jaipur" },
  { name: "Sneha Kulkarni", company: "Peakform Fitness", city: "Mumbai" },
  { name: "Aditya Rao", company: "Solstice Interiors", city: "Hyderabad" },
  { name: "Kavya Menon", company: "Fernwood Organics", city: "Kochi" },
  { name: "Rohit Malhotra", company: "Gridline Energy", city: "Gurugram" },
  { name: "Isha Bhatt", company: "Papercrane Design", city: "Ahmedabad" },
  { name: "Nikhil Joshi", company: "Basecamp Outdoors", city: "Nashik" },
  { name: "Tara D'Souza", company: "Marigold Hospitality", city: "Goa" },
  { name: "Sameer Qureshi", company: "Quanta Systems", city: "Lucknow" },
  { name: "Divya Pillai", company: "Seabird Foods", city: "Thiruvananthapuram" },
  { name: "Karan Chawla", company: "Vertex Sportswear", city: "Chandigarh" },
  { name: "Lakshmi Subramanian", company: "Tessellate Tiles", city: "Coimbatore" },
  { name: "Zoya Khan", company: "Amberline Jewellers", city: "Bhopal" },
  { name: "Harsh Patel", company: "Craftline Furniture", city: "Surat" },
  { name: "Neha Chauhan", company: "Riverbend Cafés", city: "Dehradun" },
  { name: "Siddharth Bose", company: "Arclight Media", city: "Kolkata" },
  { name: "Ritika Agarwal", company: "Stonebridge Realty", city: "Indore" },
  { name: "Manav Deshpande", company: "Halcyon Instruments", city: "Nagpur" },
  { name: "Farah Sheikh", company: "Cobalt Analytics", city: "Hyderabad" },
  { name: "Devansh Kapoor", company: "Trailhead Apparel", city: "Delhi" },
];

const PRODUCTS = [
  { sku: "AUD-NC700", name: "Aurora NC700 Headphones", priceMinor: 1249900 },
  { sku: "LAP-ZEN14", name: "Zenith 14 Ultrabook", priceMinor: 8499900 },
  { sku: "WCH-PULSE3", name: "Pulse 3 Smartwatch", priceMinor: 1899900 },
  { sku: "CAM-VISTA5", name: "Vista 5 Mirrorless Camera", priceMinor: 6299900 },
  { sku: "SPK-ECHOM", name: "EchoMini Bluetooth Speaker", priceMinor: 349900 },
  { sku: "KEY-TACT87", name: "Tactile 87 Mechanical Keyboard", priceMinor: 749900 },
  { sku: "MON-CLR27", name: "Clarity 27\" 4K Monitor", priceMinor: 3899900 },
  { sku: "CHR-ERGO2", name: "ErgoFlex 2 Task Chair", priceMinor: 2299900 },
  { sku: "TAB-SLATE11", name: "Slate 11 Tablet", priceMinor: 4599900 },
  { sku: "HUB-CONNX", name: "ConnX 8-in-1 Hub", priceMinor: 599900 },
  { sku: "PWR-VOLT20", name: "Volt 20K Power Bank", priceMinor: 299900 },
  { sku: "MIC-STUDIO1", name: "Studio One USB Microphone", priceMinor: 899900 },
];

const TICKET_TEMPLATES = [
  {
    subject: "Order has not moved since dispatch",
    description:
      "The tracking page has shown the same status for four days and the customer wants a revised delivery date.",
    category: "DELIVERY" as TicketCategory,
  },
  {
    subject: "Refund not received after cancellation",
    description:
      "Customer cancelled last week and has not seen the credit on their card statement yet.",
    category: "BILLING" as TicketCategory,
  },
  {
    subject: "Device restarts randomly",
    description: "Unit restarts two or three times a day under normal use. Purchased two months ago.",
    category: "PRODUCT" as TicketCategory,
  },
  {
    subject: "Invoice shows the wrong GST number",
    description: "Company GST details need correcting on the invoice for accounting.",
    category: "BILLING" as TicketCategory,
  },
  {
    subject: "Cannot sign in to the account portal",
    description: "Password reset email is not arriving. Customer has checked spam.",
    category: "ACCOUNT" as TicketCategory,
  },
  {
    subject: "Wrong item delivered",
    description: "Customer received a different SKU from the one ordered and wants a replacement.",
    category: "PRODUCT" as TicketCategory,
  },
  {
    subject: "Delivery address needs changing",
    description: "Customer has moved office and wants the parcel redirected before dispatch.",
    category: "DELIVERY" as TicketCategory,
  },
  {
    subject: "Request for extended warranty",
    description: "Customer wants to add 24 months of extended cover to a recent purchase.",
    category: "PRODUCT" as TicketCategory,
  },
  {
    subject: "Bulk order quote request",
    description: "Customer is asking for pricing on 40 units for a corporate rollout.",
    category: "OTHER" as TicketCategory,
  },
  {
    subject: "Damaged packaging on arrival",
    description: "Outer box was crushed. Customer wants confirmation the unit is not affected.",
    category: "PRODUCT" as TicketCategory,
  },
];

interface SeededOrder {
  id: string;
  reference: string;
  customerId: string;
  customerName: string;
  totalAmountMinor: number;
  status: OrderStatus;
  deliveryStatus: DeliveryStatus;
}

async function reset() {
  // Order matters: children first, even though cascades exist, so the seed is
  // safe to re-run against a partially populated database.
  await prisma.auditLog.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.toolCall.deleteMany();
  await prisma.message.deleteMany();
  await prisma.escalation.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.email.deleteMany();
  await prisma.knowledgeChunk.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
  await prisma.supportTicket.deleteMany();
  await prisma.refund.deleteMany();
  await prisma.orderEvent.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organizationSettings.deleteMany();
}

async function seedUsers() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users = [];
  for (const user of USERS) {
    users.push(
      await prisma.user.create({
        data: { ...user, passwordHash, createdAt: daysAgo(between(120, 400)) },
      }),
    );
  }
  return users;
}

async function seedCustomers() {
  const customers = [];
  for (const [index, customer] of CUSTOMERS.entries()) {
    const slug = customer.name.toLowerCase().replace(/[^a-z]+/g, ".");
    const domain = customer.company.toLowerCase().replace(/[^a-z]+/g, "");
    customers.push(
      await prisma.customer.create({
        data: {
          reference: `CUST-${1001 + index}`,
          name: customer.name,
          email: `${slug}@${domain}.example`,
          phone: `+91 9${between(100000000, 899999999)}`,
          company: customer.company,
          status: index % 11 === 0 ? "PROSPECT" : index % 17 === 0 ? "INACTIVE" : "ACTIVE",
          notes:
            index % 5 === 0
              ? `Key account in ${customer.city}. Prefers email over phone.`
              : null,
          lastContactedAt: daysAgo(between(1, 60)),
          createdAt: daysAgo(between(60, 500)),
        },
      }),
    );
  }
  return customers;
}

function orderProfile(index: number): {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  deliveryStatus: DeliveryStatus;
} {
  // A fixed distribution keeps dashboards and charts interesting but stable.
  // Index 3 is ORD-1004, the order used throughout the documented demo script:
  // paid and shipped but running late, so cancel, refund and outreach all apply.
  if (index === 3) {
    return { status: "SHIPPED", paymentStatus: "PAID", deliveryStatus: "DELAYED" };
  }
  const bucket = index % 10;
  if (bucket <= 3) return { status: "DELIVERED", paymentStatus: "PAID", deliveryStatus: "DELIVERED" };
  if (bucket === 4) return { status: "SHIPPED", paymentStatus: "PAID", deliveryStatus: "DELAYED" };
  if (bucket === 5) return { status: "SHIPPED", paymentStatus: "PAID", deliveryStatus: "IN_TRANSIT" };
  if (bucket === 6) return { status: "PROCESSING", paymentStatus: "PAID", deliveryStatus: "NOT_SHIPPED" };
  if (bucket === 7) return { status: "PENDING", paymentStatus: "UNPAID", deliveryStatus: "NOT_SHIPPED" };
  if (bucket === 8) return { status: "CANCELLED", paymentStatus: "UNPAID", deliveryStatus: "NOT_SHIPPED" };
  return { status: "REFUNDED", paymentStatus: "REFUNDED", deliveryStatus: "RETURNED" };
}

async function seedOrders(customers: Array<{ id: string; name: string }>) {
  const orders: SeededOrder[] = [];

  for (let index = 0; index < 40; index += 1) {
    const reference = `ORD-${1001 + index}`;
    // ORD-1004 is the documented demo order and always belongs to Priya Sharma.
    const customer = index === 3 ? customers[0]! : customers[(index * 7 + 3) % customers.length]!;
    const profile = orderProfile(index);
    const placedAt = daysAgo(between(1, 60));
    const expected = new Date(placedAt);
    expected.setDate(expected.getDate() + between(3, 9));

    const items =
      index === 3
        ? [{ ...PRODUCTS[0]!, quantity: 1 }]
        : Array.from({ length: between(1, 3) }, () => ({
            ...pick(PRODUCTS),
            quantity: between(1, 2),
          }));

    const deduped = items.filter(
      (item, position) => items.findIndex((other) => other.sku === item.sku) === position,
    );
    const totalAmountMinor = deduped.reduce(
      (sum, item) => sum + item.priceMinor * item.quantity,
      0,
    );

    const delivered = profile.deliveryStatus === "DELIVERED";
    const deliveredAt = delivered ? new Date(expected.getTime() - 86_400_000) : null;
    const refundedAmountMinor = profile.paymentStatus === "REFUNDED" ? totalAmountMinor : 0;

    const order = await prisma.order.create({
      data: {
        reference,
        customerId: customer.id,
        status: profile.status,
        paymentStatus: profile.paymentStatus,
        deliveryStatus: profile.deliveryStatus,
        currency: "INR",
        totalAmountMinor,
        refundedAmountMinor,
        placedAt,
        expectedDeliveryAt: expected,
        deliveredAt,
        cancelledAt: profile.status === "CANCELLED" ? new Date(placedAt.getTime() + 3_600_000) : null,
        cancellationReason:
          profile.status === "CANCELLED" ? "Customer changed their mind before dispatch" : null,
        createdAt: placedAt,
        items: {
          create: deduped.map((item) => ({
            sku: item.sku,
            name: item.name,
            quantity: item.quantity,
            unitPriceMinor: item.priceMinor,
          })),
        },
      },
    });

    const events: Array<{ type: string; description: string; at: Date; actorType: ActorType }> = [
      { type: "ORDER_PLACED", description: "Order placed by the customer", at: placedAt, actorType: "SYSTEM" },
    ];
    if (profile.paymentStatus !== "UNPAID") {
      events.push({
        type: "PAYMENT_CAPTURED",
        description: `Payment of ₹${(totalAmountMinor / 100).toLocaleString("en-IN")} captured`,
        at: new Date(placedAt.getTime() + 900_000),
        actorType: "SYSTEM",
      });
    }
    if (["SHIPPED", "DELIVERED", "REFUNDED"].includes(profile.status)) {
      events.push({
        type: "ORDER_DISPATCHED",
        description: "Parcel handed to the carrier",
        at: new Date(placedAt.getTime() + 2 * 86_400_000),
        actorType: "SYSTEM",
      });
    }
    if (profile.deliveryStatus === "DELAYED") {
      events.push({
        type: "DELIVERY_DELAYED",
        description: "Carrier missed the promised delivery window",
        at: new Date(expected.getTime() + 86_400_000),
        actorType: "SYSTEM",
      });
    }
    if (deliveredAt) {
      events.push({
        type: "ORDER_DELIVERED",
        description: "Parcel delivered and signed for",
        at: deliveredAt,
        actorType: "SYSTEM",
      });
    }
    if (profile.status === "CANCELLED") {
      events.push({
        type: "ORDER_CANCELLED",
        description: "Order cancelled before dispatch",
        at: new Date(placedAt.getTime() + 3_600_000),
        actorType: "USER",
      });
    }
    if (refundedAmountMinor > 0) {
      events.push({
        type: "REFUND_ISSUED",
        description: `Full refund of ₹${(refundedAmountMinor / 100).toLocaleString("en-IN")} issued`,
        at: new Date(placedAt.getTime() + 6 * 86_400_000),
        actorType: "USER",
      });
    }

    await prisma.orderEvent.createMany({
      data: events.map((event) => ({
        orderId: order.id,
        type: event.type,
        description: event.description,
        actorType: event.actorType,
        createdAt: event.at,
      })),
    });

    if (refundedAmountMinor > 0) {
      await prisma.refund.create({
        data: {
          reference: `REF-${1000 + orders.length + 1}`,
          orderId: order.id,
          amountMinor: refundedAmountMinor,
          currency: "INR",
          status: "COMPLETED",
          reason: "Item returned within the refund window",
          actorType: "USER",
          createdAt: new Date(placedAt.getTime() + 6 * 86_400_000),
        },
      });
    }

    orders.push({
      id: order.id,
      reference: order.reference,
      customerId: customer.id,
      customerName: customer.name,
      totalAmountMinor,
      status: profile.status,
      deliveryStatus: profile.deliveryStatus,
    });
  }

  return orders;
}

async function seedTickets(
  customers: Array<{ id: string; name: string }>,
  orders: SeededOrder[],
  staff: Array<{ id: string; role: string }>,
) {
  const assignable = staff.filter((user) => user.role !== "VIEWER");
  const statuses: TicketStatus[] = [
    "OPEN",
    "OPEN",
    "IN_PROGRESS",
    "IN_PROGRESS",
    "WAITING",
    "RESOLVED",
    "CLOSED",
  ];
  const priorities: TicketPriority[] = ["LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "URGENT"];

  const tickets = [];
  for (let index = 0; index < 30; index += 1) {
    const template = TICKET_TEMPLATES[index % TICKET_TEMPLATES.length]!;
    const customer = customers[(index * 5 + 2) % customers.length]!;
    const relatedOrder = orders.find((order) => order.customerId === customer.id) ?? null;
    const status = statuses[index % statuses.length]!;
    const createdAt = daysAgo(between(1, 45));
    const createdBy: ActorType = index % 4 === 0 ? "AGENT" : "USER";

    tickets.push(
      await prisma.supportTicket.create({
        data: {
          reference: `TKT-${1001 + index}`,
          customerId: customer.id,
          orderId: relatedOrder?.id ?? null,
          subject: template.subject,
          description: template.description,
          status,
          priority: priorities[index % priorities.length]!,
          category: template.category,
          assignedToId: index % 3 === 0 ? null : pick(assignable).id,
          createdBy,
          resolvedAt: ["RESOLVED", "CLOSED"].includes(status)
            ? new Date(createdAt.getTime() + between(4, 72) * 3_600_000)
            : null,
          createdAt,
          updatedAt: createdAt,
        },
      }),
    );
  }

  // A guaranteed open, high-priority ticket for the documented demo customer.
  const priya = customers[0]!;
  const priyaOrder = orders.find((order) => order.reference === "ORD-1004");
  tickets.push(
    await prisma.supportTicket.create({
      data: {
        reference: "TKT-1031",
        customerId: priya.id,
        orderId: priyaOrder?.id ?? null,
        subject: "Order ORD-1004 is running late",
        description:
          "Customer called about the delayed headphones order and wants a revised delivery date today.",
        status: "OPEN",
        priority: "HIGH",
        category: "DELIVERY",
        assignedToId: assignable[0]?.id ?? null,
        createdBy: "USER",
        createdAt: daysAgo(2),
      },
    }),
  );

  return tickets;
}

async function seedEmails(
  customers: Array<{ id: string; name: string; email: string }>,
  users: Array<{ id: string }>,
) {
  const subjects = [
    "Update on your delayed order",
    "Your refund has been processed",
    "We've shipped your order",
    "Following up on your support ticket",
    "Your warranty claim is in progress",
  ];

  for (let index = 0; index < 14; index += 1) {
    const customer = customers[(index * 3 + 1) % customers.length]!;
    const createdAt = daysAgo(between(1, 30));
    const actorType: ActorType = index % 3 === 0 ? "USER" : "AGENT";
    await prisma.email.create({
      data: {
        customerId: customer.id,
        toEmail: customer.email,
        fromEmail: "ops@flowpilot.demo",
        subject: subjects[index % subjects.length]!,
        body: `Hi ${customer.name.split(" ")[0]},\n\nThanks for your patience — here is the latest update on your request. Our operations team is on it and will confirm next steps within one working day.\n\nBest,\nFlowPilot Operations`,
        status: "SENT",
        provider: "mock",
        actorType,
        sentById: users[index % users.length]!.id,
        sentAt: createdAt,
        createdAt,
      },
    });
  }
}

async function seedKnowledge(uploadedById: string) {
  const files = [
    { file: "refund-policy.md", title: "Refund Policy" },
    { file: "shipping-and-delivery-sla.md", title: "Shipping and Delivery SLA" },
    { file: "warranty-and-returns.md", title: "Warranty and Returns Handbook" },
    { file: "support-escalation-playbook.md", title: "Support Escalation Playbook" },
    { file: "data-privacy-and-security.md", title: "Data Privacy and Security Standard" },
  ];

  for (const entry of files) {
    const filePath = path.join(process.cwd(), "prisma", "seed-data", entry.file);
    const content = await readFile(filePath, "utf8");
    const document = await prisma.knowledgeDocument.create({
      data: {
        title: entry.title,
        filename: entry.file,
        mimeType: "text/markdown",
        sizeBytes: Buffer.byteLength(content, "utf8"),
        status: "PENDING",
        content,
        uploadedById,
        createdAt: daysAgo(between(20, 90)),
      },
    });
    await ingestDocument(document.id);
  }
}

interface ScenarioTool {
  name: string;
  args: Record<string, unknown>;
  summary: string;
  risk: RiskLevel;
  failed?: boolean;
}

interface Scenario {
  user: string;
  assistant: string;
  tools: ScenarioTool[];
  usedKnowledge?: boolean;
  escalated?: boolean;
}

function buildScenarios(orders: SeededOrder[], customers: Array<{ name: string; reference: string }>): Scenario[] {
  const delayed = orders.filter((order) => order.deliveryStatus === "DELAYED");
  const first = orders[0]!;
  const someone = customers[3]!;

  return [
    {
      user: "Show me order ORD-1004.",
      assistant: `Order ORD-1004 for Priya Sharma — ₹12,499.00 — status Shipped, payment Paid, delivery Delayed.`,
      tools: [
        {
          name: "getOrder",
          args: { orderId: "ORD-1004" },
          summary: "Order ORD-1004 for Priya Sharma — ₹12,499.00 — status Shipped, delivery Delayed.",
          risk: "LOW",
        },
      ],
    },
    {
      user: "Find customer Priya Sharma.",
      assistant:
        "Found Priya Sharma (CUST-1001, priya.sharma@lumenretail.example) with orders and tickets on file.",
      tools: [
        {
          name: "searchCustomers",
          args: { query: "Priya Sharma" },
          summary: "Found Priya Sharma (CUST-1001) with 2 orders and 1 ticket.",
          risk: "LOW",
        },
      ],
    },
    {
      user: "Which orders are delayed right now?",
      assistant: `There are ${delayed.length} delayed orders. The oldest is ${delayed[0]?.reference ?? "ORD-1004"}.`,
      tools: [
        {
          name: "searchOrders",
          args: { delayedOnly: true, limit: 10 },
          summary: `Found ${delayed.length} delayed orders.`,
          risk: "LOW",
        },
      ],
    },
    {
      user: "According to our refund policy, can a delivered order be refunded?",
      assistant:
        "Based on our knowledge base: customers can request a refund within 30 days of delivery, provided the item is unused and in its original packaging.",
      tools: [
        {
          name: "searchKnowledgeBase",
          args: { query: "refund policy delivered order" },
          summary: "Found 3 relevant passages in 1 document.",
          risk: "LOW",
        },
      ],
      usedKnowledge: true,
    },
    {
      user: `Create a high priority ticket for ${someone.name} because their order is delayed.`,
      assistant: `Created HIGH-priority ticket for ${someone.name}.`,
      tools: [
        {
          name: "searchCustomers",
          args: { query: someone.name },
          summary: `Found ${someone.name} (${someone.reference}).`,
          risk: "LOW",
        },
        {
          name: "createSupportTicket",
          args: { customerId: someone.reference, subject: "Order is delayed", priority: "HIGH" },
          summary: `Created HIGH-priority ticket for ${someone.name}.`,
          risk: "MEDIUM",
        },
      ],
    },
    {
      user: "What is the SLA for express delivery to a metro city?",
      assistant:
        "Based on our knowledge base: express delivery to metro cities is one working day, counted from when the order moves to processing.",
      tools: [
        {
          name: "searchKnowledgeBase",
          args: { query: "express delivery SLA metro" },
          summary: "Found 2 relevant passages in 1 document.",
          risk: "LOW",
        },
      ],
      usedKnowledge: true,
    },
    {
      user: "Show me the history of order " + first.reference,
      assistant: `Order ${first.reference} has a full event timeline recorded.`,
      tools: [
        {
          name: "getOrderHistory",
          args: { orderId: first.reference },
          summary: `Order ${first.reference} has 4 recorded events.`,
          risk: "LOW",
        },
      ],
    },
    {
      user: "The customer is threatening to go to the consumer court. What do I do?",
      assistant:
        "I've escalated this to a human specialist — legal exposure is outside what I should handle on my own.",
      tools: [
        {
          name: "escalateToHuman",
          args: { reason: "Potential legal exposure raised by the customer" },
          summary: "Escalated to a human specialist (potential legal exposure).",
          risk: "MEDIUM",
        },
      ],
      escalated: true,
    },
    {
      user: "Look up ticket TKT-1003.",
      assistant: "Ticket TKT-1003 is currently in progress.",
      tools: [
        {
          name: "getTicket",
          args: { ticketId: "TKT-1003" },
          summary: "Ticket TKT-1003 — In Progress, Medium priority.",
          risk: "LOW",
        },
      ],
    },
    {
      user: "Refund order ORD-9999.",
      assistant: `I couldn't complete that. Order "ORD-9999" was not found.`,
      tools: [
        {
          name: "getOrder",
          args: { orderId: "ORD-9999" },
          summary: "",
          risk: "LOW",
          failed: true,
        },
      ],
    },
  ];
}

async function seedConversations(
  users: Array<{ id: string; name: string; role: string }>,
  orders: SeededOrder[],
  customers: Array<{ name: string; reference: string }>,
) {
  const operators = users.filter((user) => user.role !== "VIEWER");
  const scenarios = buildScenarios(orders, customers);

  for (let index = 0; index < 22; index += 1) {
    const scenario = scenarios[index % scenarios.length]!;
    const user = operators[index % operators.length]!;
    const createdAt = daysAgo(between(0, 27), between(9, 19));

    const conversation = await prisma.conversation.create({
      data: {
        userId: user.id,
        title: scenario.user.slice(0, 70),
        createdAt,
        updatedAt: createdAt,
      },
    });

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: scenario.user,
        createdAt,
      },
    });

    let cursor = createdAt.getTime() + 1000;
    for (const tool of scenario.tools) {
      const durationMs = between(40, 900);
      const result = tool.failed
        ? { ok: false, code: "NOT_FOUND", error: 'Order "ORD-9999" was not found.' }
        : { ok: true, summary: tool.summary, data: {} };

      const toolCall = await prisma.toolCall.create({
        data: {
          conversationId: conversation.id,
          name: tool.name,
          args: tool.args as never,
          result: result as never,
          status: tool.failed ? "FAILED" : "SUCCESS",
          riskLevel: tool.risk,
          error: tool.failed ? 'Order "ORD-9999" was not found.' : null,
          durationMs,
          createdAt: new Date(cursor),
          completedAt: new Date(cursor + durationMs),
        },
      });

      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: "TOOL",
          content: JSON.stringify(result),
          metadata: { toolCallId: toolCall.id, name: tool.name } as never,
          createdAt: new Date(cursor + durationMs),
        },
      });

      await prisma.auditLog.create({
        data: {
          action: `agent.tool.${tool.name}`,
          actorType: "AGENT",
          userId: user.id,
          conversationId: conversation.id,
          toolCallId: toolCall.id,
          tool: tool.name,
          input: tool.args as never,
          output: result as never,
          success: !tool.failed,
          riskLevel: tool.risk,
          errorMessage: tool.failed ? 'Order "ORD-9999" was not found.' : null,
          durationMs,
          createdAt: new Date(cursor + durationMs),
        },
      });

      cursor += durationMs + 200;
    }

    const latencyMs = between(320, 2600);
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: scenario.assistant,
        metadata: {
          provider: "mock",
          model: "flowpilot-mock-1",
          latencyMs,
          usedKnowledge: scenario.usedKnowledge ?? false,
          escalated: scenario.escalated ?? false,
        } as never,
        createdAt: new Date(cursor),
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date(cursor) },
    });

    await prisma.agentRun.create({
      data: {
        conversationId: conversation.id,
        userId: user.id,
        provider: "mock",
        model: "flowpilot-mock-1",
        status: "completed",
        latencyMs,
        promptTokens: between(400, 1800),
        completionTokens: between(60, 400),
        costUsdMicros: between(200, 1800),
        toolCallCount: scenario.tools.length,
        usedKnowledge: scenario.usedKnowledge ?? false,
        escalated: scenario.escalated ?? false,
        createdAt: new Date(cursor),
      },
    });

    if (scenario.escalated) {
      await prisma.escalation.create({
        data: {
          conversationId: conversation.id,
          reason: "Potential legal exposure raised by the customer",
          summary: scenario.user,
          status: index % 2 === 0 ? "OPEN" : "ACKNOWLEDGED",
          createdAt: new Date(cursor),
        },
      });
    }
  }
}

/** Pending and historical approvals so the approvals queue is never empty. */
async function seedApprovals(
  users: Array<{ id: string; name: string; role: string }>,
  orders: SeededOrder[],
) {
  const admin = users.find((user) => user.role === "ADMIN")!;
  const operator = users.find((user) => user.role === "AGENT")!;

  const refundTarget = orders.find(
    (order) => order.status === "DELIVERED" && order.totalAmountMinor > 100000,
  )!;
  const cancelTarget = orders.find((order) => order.status === "PROCESSING")!;

  const pending: Array<{
    tool: string;
    args: Record<string, unknown>;
    summary: string;
    risk: RiskLevel;
    requestedById: string;
    userText: string;
  }> = [
    {
      tool: "createRefund",
      args: { orderId: refundTarget.reference, reason: "Customer reported a faulty unit" },
      summary: `Refund order ${refundTarget.reference}`,
      risk: "HIGH",
      requestedById: operator.id,
      userText: `Refund ${refundTarget.reference} — the customer says the unit is faulty.`,
    },
    {
      tool: "cancelOrder",
      args: { orderId: cancelTarget.reference, reason: "Customer no longer needs the item" },
      summary: `Cancel order ${cancelTarget.reference}`,
      risk: "HIGH",
      requestedById: admin.id,
      userText: `Cancel ${cancelTarget.reference} please.`,
    },
    {
      tool: "sendCustomerEmail",
      args: {
        customerId: orders[4]!.customerId,
        subject: `Update on your order ${orders[4]!.reference}`,
        body: "Hi, we're writing about your delayed order…",
      },
      summary: `Email ${orders[4]!.customerName}`,
      risk: "HIGH",
      requestedById: operator.id,
      userText: `Send a follow-up email about ${orders[4]!.reference}.`,
    },
  ];

  for (const [index, entry] of pending.entries()) {
    const createdAt = daysAgo(between(0, 3), between(10, 18));
    const conversation = await prisma.conversation.create({
      data: {
        userId: entry.requestedById,
        title: entry.userText.slice(0, 70),
        createdAt,
        updatedAt: createdAt,
      },
    });

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content: entry.userText,
        createdAt,
      },
    });

    const toolCall = await prisma.toolCall.create({
      data: {
        conversationId: conversation.id,
        name: entry.tool,
        args: entry.args as never,
        status: "AWAITING_APPROVAL",
        riskLevel: entry.risk,
        createdAt: new Date(createdAt.getTime() + 800),
      },
    });

    const approval = await prisma.approval.create({
      data: {
        toolCallId: toolCall.id,
        conversationId: conversation.id,
        toolName: entry.tool,
        args: entry.args as never,
        summary: entry.summary,
        riskLevel: entry.risk,
        status: "PENDING",
        requestedById: entry.requestedById,
        expiresAt: daysFromNow(1),
        createdAt: new Date(createdAt.getTime() + 900),
      },
    });

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: `This action needs your approval before it runs.\n\n- **Action:** ${entry.summary}\n\nDo you want me to proceed?`,
        metadata: {
          provider: "mock",
          model: "flowpilot-mock-1",
          awaitingApprovalId: approval.id,
        } as never,
        createdAt: new Date(createdAt.getTime() + 1000),
      },
    });

    await prisma.toolCall.update({ where: { id: toolCall.id }, data: { messageId: message.id } });

    await prisma.auditLog.create({
      data: {
        action: "agent.approval_requested",
        actorType: "AGENT",
        userId: entry.requestedById,
        conversationId: conversation.id,
        toolCallId: toolCall.id,
        tool: entry.tool,
        input: entry.args as never,
        success: true,
        riskLevel: entry.risk,
        approvalStatus: "PENDING",
        createdAt: new Date(createdAt.getTime() + 900),
      },
    });

    await prisma.agentRun.create({
      data: {
        conversationId: conversation.id,
        userId: entry.requestedById,
        provider: "mock",
        model: "flowpilot-mock-1",
        status: "awaiting_approval",
        latencyMs: between(400, 1500),
        promptTokens: between(500, 1500),
        completionTokens: between(80, 260),
        costUsdMicros: between(300, 1400),
        toolCallCount: 1,
        createdAt: new Date(createdAt.getTime() + 1000),
        // Stagger creation so the approvals chart has more than one bucket.
        ...(index === 0 ? {} : {}),
      },
    });
  }

  // Historical decisions give the analytics page a meaningful approval rate.
  for (let index = 0; index < 9; index += 1) {
    const decided = index % 3 !== 2;
    const createdAt = daysAgo(between(4, 25), between(9, 18));
    const requester = index % 2 === 0 ? operator : admin;
    const order = orders[(index * 3 + 5) % orders.length]!;
    const tool = index % 2 === 0 ? "createRefund" : "sendCustomerEmail";

    const conversation = await prisma.conversation.create({
      data: {
        userId: requester.id,
        title: `${tool === "createRefund" ? "Refund" : "Email"} ${order.reference}`,
        createdAt,
        updatedAt: createdAt,
      },
    });

    const args =
      tool === "createRefund"
        ? { orderId: order.reference, reason: "Delivery delay beyond SLA" }
        : {
            customerId: order.customerId,
            subject: `Update on ${order.reference}`,
            body: "Hi, apologies for the delay on your order…",
          };

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "USER",
        content:
          tool === "createRefund"
            ? `Refund ${order.reference} — the delivery missed our SLA.`
            : `Send ${order.customerName} an update about ${order.reference}.`,
        createdAt,
      },
    });

    const toolCall = await prisma.toolCall.create({
      data: {
        conversationId: conversation.id,
        name: tool,
        args: args as never,
        status: decided ? "SUCCESS" : "REJECTED",
        riskLevel: "HIGH",
        result: decided
          ? ({ ok: true, summary: `Completed ${tool} for ${order.reference}`, data: {} } as never)
          : undefined,
        durationMs: between(120, 800),
        createdAt,
        completedAt: new Date(createdAt.getTime() + 60_000),
      },
    });

    await prisma.approval.create({
      data: {
        toolCallId: toolCall.id,
        conversationId: conversation.id,
        toolName: tool,
        args: args as never,
        summary: `${tool === "createRefund" ? "Refund" : "Email"} ${order.reference}`,
        riskLevel: "HIGH",
        status: decided ? "APPROVED" : "REJECTED",
        requestedById: requester.id,
        decidedById: admin.id,
        decidedAt: new Date(createdAt.getTime() + 55_000),
        decisionNote: decided ? null : "Handled manually by the finance team instead",
        expiresAt: new Date(createdAt.getTime() + 86_400_000),
        createdAt,
      },
    });

    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: decided
          ? `Done — ${tool === "createRefund" ? `refund issued on ${order.reference}` : `update sent to ${order.customerName}`}.`
          : `Understood — I did not run **${tool}**. Nothing was changed.`,
        metadata: {
          provider: "mock",
          model: "flowpilot-mock-1",
          latencyMs: between(300, 1800),
        } as never,
        createdAt: new Date(createdAt.getTime() + 60_000),
      },
    });

    await prisma.auditLog.create({
      data: {
        action: decided ? "approval.approved" : "approval.rejected",
        actorType: "USER",
        userId: admin.id,
        conversationId: conversation.id,
        toolCallId: toolCall.id,
        tool,
        input: args as never,
        success: true,
        riskLevel: "HIGH",
        approvalStatus: decided ? "APPROVED" : "REJECTED",
        createdAt: new Date(createdAt.getTime() + 55_000),
      },
    });

    await prisma.agentRun.create({
      data: {
        conversationId: conversation.id,
        userId: requester.id,
        provider: "mock",
        model: "flowpilot-mock-1",
        status: decided ? "completed" : "failed",
        latencyMs: between(500, 2400),
        promptTokens: between(600, 1600),
        completionTokens: between(100, 320),
        costUsdMicros: between(400, 1600),
        toolCallCount: 1,
        createdAt,
      },
    });
  }
}

async function seedHumanAudit(users: Array<{ id: string; role: string }>, orders: SeededOrder[]) {
  const actions = [
    { action: "customer.updated", entityType: "Customer", risk: "MEDIUM" as RiskLevel },
    { action: "ticket.created", entityType: "SupportTicket", risk: "MEDIUM" as RiskLevel },
    { action: "ticket.updated", entityType: "SupportTicket", risk: "MEDIUM" as RiskLevel },
    { action: "order.updated", entityType: "Order", risk: "MEDIUM" as RiskLevel },
    { action: "settings.updated", entityType: "OrganizationSettings", risk: "MEDIUM" as RiskLevel },
    { action: "knowledge.reindexed", entityType: "KnowledgeDocument", risk: "MEDIUM" as RiskLevel },
  ];

  for (let index = 0; index < 24; index += 1) {
    const entry = actions[index % actions.length]!;
    const user = users[index % users.length]!;
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        actorType: "USER",
        userId: user.id,
        entityType: entry.entityType,
        entityId: orders[index % orders.length]!.id,
        input: { source: "web" } as never,
        success: index % 11 !== 0,
        riskLevel: entry.risk,
        errorMessage: index % 11 === 0 ? "Record was modified by another user" : null,
        durationMs: between(15, 300),
        createdAt: daysAgo(between(0, 29), between(9, 20)),
      },
    });
  }
}

async function main() {
  console.info("Resetting database…");
  await reset();

  console.info("Seeding users and settings…");
  const users = await seedUsers();
  await prisma.organizationSettings.create({ data: { id: "org" } });

  console.info("Seeding customers…");
  const customers = await seedCustomers();

  console.info("Seeding orders…");
  const orders = await seedOrders(customers);

  console.info("Seeding support tickets…");
  await seedTickets(customers, orders, users);

  console.info("Seeding sent email…");
  await seedEmails(customers, users);

  console.info("Indexing knowledge base (extract → chunk → embed → store)…");
  await seedKnowledge(users[0]!.id);

  console.info("Seeding agent conversations…");
  await seedConversations(users, orders, customers);

  console.info("Seeding approvals…");
  await seedApprovals(users, orders);

  console.info("Seeding human audit trail…");
  await seedHumanAudit(users, orders);

  const [customerCount, orderCount, ticketCount, chunkCount, conversationCount, auditCount] =
    await Promise.all([
      prisma.customer.count(),
      prisma.order.count(),
      prisma.supportTicket.count(),
      prisma.knowledgeChunk.count(),
      prisma.conversation.count(),
      prisma.auditLog.count(),
    ]);

  console.info(
    `\nSeed complete: ${users.length} users, ${customerCount} customers, ${orderCount} orders, ${ticketCount} tickets, ${chunkCount} knowledge chunks, ${conversationCount} conversations, ${auditCount} audit records.`,
  );
  console.info(`Sign in with admin@flowpilot.demo / ${DEMO_PASSWORD}\n`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
