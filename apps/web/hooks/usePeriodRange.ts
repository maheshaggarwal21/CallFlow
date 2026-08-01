"use client";

import { useMemo, useState } from "react";
import {
  DEFAULT_PERIOD,
  rangeParams,
  resolvePeriodRange,
  type DateRange,
  type Period,
} from "@/lib/period";

/**
 * Period state + the IST date range it resolves to. Shared by the dashboard and
 * the employee pages so they always ask the API for the exact same window.
 */
export function usePeriodRange(initial: Period = DEFAULT_PERIOD) {
  const [period, setPeriod] = useState<Period>(initial);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range: DateRange = useMemo(
    () => resolvePeriodRange(period, customFrom, customTo),
    [period, customFrom, customTo]
  );

  const params = useMemo(() => rangeParams(range).toString(), [range]);

  return {
    period,
    setPeriod,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    range,
    /** `date_from=…&date_to=…`, ready to merge into a query string. */
    params,
    selectProps: {
      period,
      onPeriodChange: setPeriod,
      customFrom,
      customTo,
      onCustomFromChange: setCustomFrom,
      onCustomToChange: setCustomTo,
    },
  };
}
