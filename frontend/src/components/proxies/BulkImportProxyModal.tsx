import { useState, useRef, useCallback, type FormEvent, type DragEvent } from 'react'
import { Upload } from 'lucide-react'
import Modal from '../ui/Modal'

interface BulkImportProxyModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (addresses: string[]) => void
  isLoading: boolean
}

export default function BulkImportProxyModal({
  isOpen,
  onClose,
  onSubmit,
  isLoading,
}: BulkImportProxyModalProps) {
  const [text, setText] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const parseAddresses = (raw: string): string[] => {
    return raw
      .split(/[\n\r]+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
  }

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result
      if (typeof content === 'string') {
        setText((prev) => (prev ? prev + '\n' + content : content))
      }
    }
    reader.readAsText(file)
  }, [])

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && (file.name.endsWith('.txt') || file.type === 'text/plain')) {
      handleFile(file)
    }
  }

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const addresses = parseAddresses(text)
    if (addresses.length === 0) return
    onSubmit(addresses)
    setText('')
  }

  const handleClose = () => {
    setText('')
    onClose()
  }

  const addressCount = parseAddresses(text).length

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Bulk Import Proxies"
      size="lg"
      footer={(
        <>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg bg-gray-200 dark:bg-gray-700 px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200 transition-colors hover:bg-gray-300 dark:hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="bulk-import-proxies-form"
            disabled={isLoading || addressCount === 0}
            className="flex items-center gap-2 rounded-lg bg-[#E8461E] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#cf3d18] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            )}
            Import {addressCount > 0 ? `${addressCount} Proxies` : 'Proxies'}
          </button>
        </>
      )}
    >
      <form id="bulk-import-proxies-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">
            Proxy Addresses
            {addressCount > 0 && (
              <span className="ml-2 rounded-full bg-[#E8461E]/10 px-2 py-0.5 text-xs text-[#E8461E]">
                {addressCount} proxies
              </span>
            )}
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"socks5://user:pass@host:port\nhost:port:user:pass\nhost:port\n\n# Lines starting with # are ignored"}
            rows={8}
            className="w-full rounded-xl border border-gray-300 dark:border-white/10 bg-white dark:bg-gray-950 px-4 py-3 font-mono text-sm text-gray-900 dark:text-white outline-none transition placeholder:text-gray-500 focus:border-[#E8461E]/60 focus:ring-4 focus:ring-[#E8461E]/10"
          />
        </div>

        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 transition-colors ${
            isDragOver
              ? 'border-[#E8461E] bg-[#E8461E]/5'
              : 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-950/50 hover:border-gray-400 dark:hover:border-gray-600'
          }`}
        >
          <Upload className={`h-8 w-8 ${isDragOver ? 'text-[#E8461E]' : 'text-gray-500'}`} />
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {isDragOver ? 'Drop file here' : 'Drag & drop a .txt file, or click to browse'}
          </p>
          <p className="mt-1 text-xs text-gray-500">One proxy per line</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,text/plain"
            onChange={handleFileInput}
            className="hidden"
          />
        </div>

      </form>
    </Modal>
  )
}
