"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { titleCase } from "@/lib/utils";

const AXIS_PROPS = {
  stroke: "var(--color-muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

const tooltipStyle = {
  backgroundColor: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  fontSize: "12px",
  color: "var(--color-popover-foreground)",
};

function shortDate(value: string) {
  const date = new Date(value);
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

export function ActionsOverTimeChart({
  data,
}: {
  data: Array<{ date: string; success: number; failed: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="successFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS_PROPS} />
        <YAxis allowDecimals={false} width={38} {...AXIS_PROPS} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(value) => `Day ${shortDate(String(value))}`} />
        <Area
          type="monotone"
          dataKey="success"
          name="Successful"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          fill="url(#successFill)"
        />
        <Area
          type="monotone"
          dataKey="failed"
          name="Failed"
          stroke="var(--color-destructive)"
          strokeWidth={2}
          fill="transparent"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function HumanVsAiChart({
  data,
}: {
  data: Array<{ channel: string; ai: number; human: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="channel" {...AXIS_PROPS} />
        <YAxis allowDecimals={false} width={38} {...AXIS_PROPS} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-muted)" }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="ai" name="AI agent" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="human" name="Human" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TicketCategoryChart({
  data,
}: {
  data: Array<{ category: string; count: number }>;
}) {
  const chartData = data.map((row) => ({ ...row, label: titleCase(row.category) }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={chartData}
          dataKey="count"
          nameKey="label"
          innerRadius={48}
          outerRadius={78}
          paddingAngle={2}
          stroke="var(--color-background)"
        >
          {chartData.map((row, index) => (
            <Cell key={row.category} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function LatencyTrendChart({
  data,
}: {
  data: Array<{ date: string; avgLatencyMs: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 6, right: 6, left: -12, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} {...AXIS_PROPS} />
        <YAxis width={46} unit="ms" {...AXIS_PROPS} />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => [`${value} ms`, "Average latency"]}
          labelFormatter={(value) => `Day ${shortDate(String(value))}`}
        />
        <Line
          type="monotone"
          dataKey="avgLatencyMs"
          stroke="var(--color-chart-3)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ToolUsageChart({
  data,
}: {
  data: Array<{ tool: string; success: number; failed: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 34)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 6, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
        <XAxis type="number" allowDecimals={false} {...AXIS_PROPS} />
        <YAxis type="category" dataKey="tool" width={150} {...AXIS_PROPS} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-muted)" }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="success" name="Succeeded" stackId="a" fill="var(--color-chart-1)" radius={[0, 0, 0, 0]} />
        <Bar dataKey="failed" name="Failed" stackId="a" fill="var(--color-destructive)" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
