/**
 * The Media module, rendered as a single-module modal dialog (see
 * features/modals). This replaces the classic Neos Media backend module.
 *
 * Empty for now: it establishes the screen so the modal registry has something
 * real to open. The asset browser fills in here.
 */
export function MediaModule() {
  return (
    <div className="grid h-full place-items-center p-8 text-center text-neutral-400">
      <div>
        <p className="text-sm font-medium text-neutral-300">Media</p>
        <p className="mt-1 text-sm">The asset browser will live here.</p>
      </div>
    </div>
  )
}
