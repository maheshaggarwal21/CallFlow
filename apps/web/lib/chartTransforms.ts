import type { EmployeeAnalytics, OverviewStats } from "@callflow/shared-types";

export type LineChartPoint = OverviewStats["weekly_activity"][number];
export type BarChartPoint = { day: string; inbound: number; outbound: number };

export function toLineChartData(input: OverviewStats["weekly_activity"]): LineChartPoint[] {
  return input;
}

export function toBarChartData(input: EmployeeAnalytics["daily_breakdown"]): BarChartPoint[] {
  return input.map((row) => ({
    day: row.day_label,
    inbound: row.inbound,
    outbound: row.outbound,
  }));
}
