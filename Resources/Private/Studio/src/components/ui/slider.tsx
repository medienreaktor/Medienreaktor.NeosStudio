import * as React from 'react'
import { Slider as SliderPrimitive } from '@base-ui/react/slider'

import { cn } from '@/lib/utils'

function Slider({
  className,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn('w-full', className)}
      {...props}
    >
      <SliderPrimitive.Control className="flex w-full touch-none items-center py-2 select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative h-1.5 w-full grow rounded-full bg-neutral-300 dark:bg-neutral-700 select-none"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-indicator"
            className="rounded-full bg-blue-500 select-none"
          />
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            className="size-4 rounded-full border border-blue-500 bg-neutral-950 dark:bg-white shadow-sm outline-none select-none focus-visible:ring-[3px] focus-visible:ring-blue-500/50"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
