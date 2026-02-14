import * as React from "react"
import { cn } from "../../lib/utils"

const Table = React.forwardRef(({ className, ...props }, ref) => (
  // Important: Only provide horizontal overflow here.
  // Vertical scrolling is handled by the page-level scroll container; having both causes nested
  // scroll roots that lead to jitter at the end of infinite-scroll lists.
  <div className="relative w-full overflow-x-auto overflow-y-visible">
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b sticky top-0 z-10 bg-card", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      // Slightly tighter on mobile to reduce horizontal overflow.
      "h-11 sm:h-12 px-2 sm:px-4 text-center align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      // Slightly tighter on mobile to reduce horizontal overflow.
      "px-2 py-2 sm:p-4 text-center align-middle [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

// Sticky header variant - stays visible when scrolling vertically
const TableHeadSticky = React.forwardRef(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-11 sm:h-12 px-2 sm:px-4 text-center align-middle font-medium text-muted-foreground",
      "sticky top-0 z-10 bg-card",
      "[&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
))
TableHeadSticky.displayName = "TableHeadSticky"

// Sticky first column variant - stays visible when scrolling horizontally
const TableCellSticky = React.forwardRef(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-2 py-2 sm:p-4 text-center align-middle sticky left-0 z-10 bg-card border-r",
      "[&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
))
TableCellSticky.displayName = "TableCellSticky"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableHeadSticky,
  TableRow,
  TableCell,
  TableCellSticky,
  TableCaption,
}
