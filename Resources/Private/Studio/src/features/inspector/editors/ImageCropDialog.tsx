import { useEffect, useMemo, useState } from 'react'
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
  type PercentCrop,
} from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { Loader2Icon } from 'lucide-react'

import { createImageVariant, type CropRect, type MediaAsset } from '@/api/media'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { CropConfig } from './cropOptions'

/** A selectable ratio in the dialog; `aspect` undefined means a free crop. */
interface RatioOption {
  value: string
  label: string
  aspect: number | undefined
}

const FREE = '__free'
const ORIGINAL = '__original'
const LOCKED = '__locked'

/** Whether two aspect ratios are equal within a small tolerance. */
function sameAspect(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01
}

/** A centered crop of the given aspect covering most of the image (percent). */
function centeredAspectCrop(aspect: number, width: number, height: number) {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 90 }, aspect, width, height),
    width,
    height,
  )
}

interface ImageCropDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The original image to crop - never a variant, so the crop is not compounded. */
  original: MediaAsset | null
  /** The current crop (original pixels) to prefill when re-cropping. */
  initialCrop?: CropRect | null
  config: CropConfig
  /** Called with the freshly created variant once the crop is applied. */
  onApply: (variant: MediaAsset) => void
}

/**
 * Cropping an image: the user drags a crop rectangle over the original,
 * optionally constrained to one of the aspect-ratio presets declared on the
 * node type. Applying creates a persisted ImageVariant server-side and hands it
 * back. The crop is edited in percentages (relative to the shown preview, whose
 * aspect matches the original) and converted to original pixels on apply, so
 * the preview's display size never affects the stored crop.
 */
export function ImageCropDialog({
  open,
  onOpenChange,
  original,
  initialCrop,
  config,
  onApply,
}: ImageCropDialogProps) {
  const [selected, setSelected] = useState<string>(FREE)
  const [crop, setCrop] = useState<PercentCrop | undefined>()
  const [busy, setBusy] = useState(false)

  const width = original?.width ?? null
  const height = original?.height ?? null
  const dimsKnown = width !== null && height !== null && width > 0 && height > 0

  // The ratio options, driven by the node type's crop configuration.
  const options = useMemo<RatioOption[]>(() => {
    if (config.locked) {
      return [
        {
          value: LOCKED,
          label: `${config.locked.width}:${config.locked.height}`,
          aspect: config.locked.width / config.locked.height,
        },
      ]
    }
    const list: RatioOption[] = config.presets.map((preset) => ({
      value: preset.id,
      label: preset.label,
      aspect: preset.width / preset.height,
    }))
    if (config.allowOriginal && dimsKnown) {
      list.push({
        value: ORIGINAL,
        label: 'Original',
        aspect: width! / height!,
      })
    }
    // Always keep a free crop reachable when nothing else constrains the tool,
    // so a bare ImageEditor (no presets) is still usable.
    if (config.allowCustom || list.length === 0) {
      list.push({ value: FREE, label: 'Free', aspect: undefined })
    }
    return list
  }, [config, dimsKnown, width, height])

  const aspectOf = (value: string): number | undefined =>
    options.find((o) => o.value === value)?.aspect

  // (Re)initialise the selection and crop whenever the dialog opens on an
  // image. Prefill from an existing crop; otherwise honour defaultOption.
  useEffect(() => {
    if (!open || !dimsKnown) return

    const prefill: PercentCrop | undefined = initialCrop
      ? {
          unit: '%',
          x: (initialCrop.x / width!) * 100,
          y: (initialCrop.y / height!) * 100,
          width: (initialCrop.width / width!) * 100,
          height: (initialCrop.height / height!) * 100,
        }
      : undefined

    // Pick the option that best matches the situation.
    let initial = options[0]?.value ?? FREE
    if (config.locked) {
      initial = LOCKED
    } else if (prefill) {
      const prefillAspect = prefill.width / prefill.height
      const match = options.find(
        (o) => o.aspect !== undefined && sameAspect(o.aspect, prefillAspect),
      )
      initial =
        match?.value ?? (options.some((o) => o.value === FREE) ? FREE : initial)
    } else if (
      config.defaultOption &&
      options.some((o) => o.value === config.defaultOption)
    ) {
      initial = config.defaultOption
    }

    setSelected(initial)
    const aspect = aspectOf(initial)
    setCrop(
      prefill ??
        (aspect
          ? centeredAspectCrop(aspect, width!, height!)
          : { unit: '%', x: 5, y: 5, width: 90, height: 90 }),
    )
    // Re-run when a different image is loaded into the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, original?.identifier, dimsKnown])

  function selectRatio(value: string) {
    setSelected(value)
    const aspect = aspectOf(value)
    // A fixed ratio reshapes the crop; free keeps whatever is drawn.
    if (aspect && dimsKnown)
      setCrop(centeredAspectCrop(aspect, width!, height!))
  }

  async function apply() {
    if (!original || !crop || !dimsKnown) return
    const pixels: CropRect = {
      x: Math.round((crop.x / 100) * width!),
      y: Math.round((crop.y / 100) * height!),
      width: Math.round((crop.width / 100) * width!),
      height: Math.round((crop.height / 100) * height!),
    }
    if (pixels.width <= 0 || pixels.height <= 0) {
      toast.info('Draw a crop area first.')
      return
    }
    setBusy(true)
    try {
      const originalId = original.localAssetIdentifier ?? original.identifier
      const variant = await createImageVariant(originalId, pixels)
      onApply(variant)
      onOpenChange(false)
    } catch (e) {
      toast.error(e instanceof Error ? e : 'Cropping failed.', {
        title: 'Cropping failed',
      })
    } finally {
      setBusy(false)
    }
  }

  const showSelector = !config.locked && options.length > 1
  const aspect = aspectOf(selected)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Crop image</DialogTitle>
        </DialogHeader>

        {showSelector && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-400">Aspect ratio</span>
            <Select
              value={selected}
              onValueChange={(value) => selectRatio(String(value))}
            >
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex max-h-[60vh] items-center justify-center overflow-hidden rounded-md border border-neutral-700 bg-neutral-950">
          {!original ? (
            <Loader2Icon className="size-6 animate-spin text-neutral-500" />
          ) : !dimsKnown || !original.previewUri ? (
            <span className="py-12 text-sm text-neutral-500">
              This image cannot be cropped.
            </span>
          ) : (
            <ReactCrop
              crop={crop}
              onChange={(_, percentCrop) => setCrop(percentCrop)}
              aspect={aspect}
              keepSelection
              className="max-h-[60vh]"
            >
              <img
                src={original.previewUri}
                alt={original.label}
                className="max-h-[60vh] w-auto object-contain"
              />
            </ReactCrop>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button disabled={busy || !dimsKnown || !crop} onClick={apply}>
            {busy ? 'Applying…' : 'Apply crop'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
