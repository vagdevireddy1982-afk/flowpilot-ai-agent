"use client";

import { Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { titleCase } from "@/lib/utils";

export interface FilterConfig {
  key: string;
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}

const ALL = "__all__";

/** Search box plus a row of enum filters, shared by every record table. */
export function DataToolbar({
  search,
  onSearchChange,
  placeholder = "Search…",
  filters = [],
  children,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  filters?: FilterConfig[];
  children?: ReactNode;
}) {
  const hasFilters = filters.some((filter) => filter.value !== "");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={placeholder}
          className="pl-8"
        />
      </div>

      {filters.map((filter) => (
        <Select
          key={filter.key}
          value={filter.value === "" ? ALL : filter.value}
          onValueChange={(value) => filter.onChange(value === ALL ? "" : value)}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder={filter.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All {filter.label.toLowerCase()}</SelectItem>
            {filter.options.map((option) => (
              <SelectItem key={option} value={option}>
                {titleCase(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}

      {hasFilters || search ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onSearchChange("");
            for (const filter of filters) filter.onChange("");
          }}
        >
          <X /> Clear
        </Button>
      ) : null}

      {children}
    </div>
  );
}
