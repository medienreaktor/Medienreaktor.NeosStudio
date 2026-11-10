/**
 * The shell's UI primitives, as plugins may use them: the public half of
 * src/components/ui. A plugin imports them from '@medienreaktor/neos-studio'
 * like any other part of the plugin API and gets the shell's own instances -
 * same React, same Base UI contexts, same portals - styled by the shell's
 * stylesheet, so a plugin's dialog, menu or form looks and behaves like a
 * built-in one and follows theme and design changes without a rebuild.
 *
 * The contract is the component names and props exported here; markup and
 * class lists are internal. `className` is accepted and merged, but the
 * shell's CSS only contains the utilities the shell itself uses - a plugin
 * styles its own classes from its own stylesheet (README "Styling plugins"),
 * not with Tailwind utilities.
 *
 * Left out on purpose: the shell's layout (Sidebar*, the resize handle), the
 * toast host (plugins use the `toast` API) and cva variant helpers.
 *
 * Exporting a component here makes its props part of the plugin API. Several
 * are typed through Base UI's props (inlined into the published types by
 * scripts/build-plugin-types.mjs), so check this list when upgrading
 * @base-ui/react: a breaking prop change there is a breaking change of the
 * plugin API and needs a `version` bump.
 */

export { Badge } from '@/components/ui/badge'
export { Button } from '@/components/ui/button'
export { Checkbox } from '@/components/ui/checkbox'
export { CollapsibleGroup } from '@/components/ui/collapsible-group'
export {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxStatus,
  ComboboxTrigger,
} from '@/components/ui/combobox'
export { ConfirmDialog } from '@/components/ui/confirm-dialog'
export {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
export { CountBadge } from '@/components/ui/count-badge'
export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
export { Field } from '@/components/ui/field'
export { Icon } from '@/components/ui/icon'
export type { IconProps, IconSize, IconVariant } from '@/components/ui/icon'
export { Input } from '@/components/ui/input'
export { Placeholder } from '@/components/ui/placeholder'
export {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
export { SearchInput } from '@/components/ui/search-input'
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
export { Separator } from '@/components/ui/separator'
export {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
export { Skeleton } from '@/components/ui/skeleton'
export { Slider } from '@/components/ui/slider'
export { LoadingState, Spinner } from '@/components/ui/spinner'
export {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
export { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
export { Textarea } from '@/components/ui/textarea'
export { Toggle } from '@/components/ui/toggle'
export { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
