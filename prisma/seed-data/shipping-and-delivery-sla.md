# Shipping and Delivery SLA

Version 2.8 · Owner: Logistics · Last reviewed: 2 February

## 1. Promised delivery windows

| Service level | Metro cities | Rest of India |
| ------------- | ------------ | ------------- |
| Standard      | 3 working days | 5–7 working days |
| Express       | 1 working day  | 2–3 working days |
| Heavy / bulky | 5 working days | 8–10 working days |

Working days exclude Sundays and gazetted holidays. The clock starts when the order moves to
`PROCESSING`, not when the customer places it.

## 2. When an order counts as delayed

An order is marked `DELAYED` when the current date passes the expected delivery date and the
carrier has not confirmed delivery. FlowPilot flags these automatically; the delayed queue is
reviewed every morning by the operations team.

An order that is more than 5 working days past its expected delivery date is treated as a
**severe delay** and must be proactively communicated to the customer the same day.

## 3. Proactive communication

For any delay we send the customer an update within 24 hours of the miss. The message must:

- name the order reference,
- acknowledge the delay without inventing a cause,
- give a revised delivery estimate or promise one within 24 hours,
- offer cancellation as an option.

Do not promise compensation in a delay email. Compensation is handled under the refund policy
and needs its own approval.

## 4. Lost and undelivered parcels

A parcel with no carrier scan for 7 consecutive days is treated as lost. Operators raise a
`DELIVERY` category ticket with `HIGH` priority, and the customer is offered a replacement or
a full refund. Lost-parcel refunds do not require the item to be returned.

## 5. Failed delivery attempts

Carriers make three delivery attempts. After the third failure the parcel returns to the
warehouse, the order moves to `RETURNED`, and the customer is refunded minus the return
shipping fee where the failure was caused by an incorrect address supplied by the customer.

## 6. Address changes

Address changes are only possible while the order is `PENDING` or `PROCESSING`. Once a parcel
is with the carrier the address is locked; the customer must accept delivery and return the
item, or refuse delivery so it comes back to the warehouse.

## 7. Escalation

Delivery escalations go to the logistics duty manager. Escalate immediately when a customer
reports a delivery that was marked delivered but never arrived, when a parcel contains a
high-value item over ₹50,000, or when the customer mentions legal action.
