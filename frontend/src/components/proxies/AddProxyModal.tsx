import { useState, type FormEvent } from 'react'
import Modal from '../ui/Modal'

interface AddProxyModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (address: string) => void
  isLoading: boolean
}

export default function AddProxyModal({ isOpen, onClose, onSubmit, isLoading }: AddProxyModalProps) {
  const [address, setAddress] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = address.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    setAddress('')
  }

  const handleClose = () => {
    setAddress('')
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Proxy"
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
            form="add-proxy-form"
            disabled={isLoading || !address.trim()}
            className="flex items-center gap-2 rounded-lg bg-[#E8461E] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#cf3d18] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading && (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            )}
            Add Proxy
          </button>
        </>
      )}
    >
      <form id="add-proxy-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="proxy-address" className="mb-2 block text-sm font-medium text-gray-800 dark:text-gray-200">
            Proxy Address
          </label>
          <input
            id="proxy-address"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="protocol://user:pass@host:port"
            className="w-full rounded-xl border border-gray-300 dark:border-white/10 bg-white dark:bg-gray-950 px-4 py-3 text-sm text-gray-900 dark:text-white outline-none transition placeholder:text-gray-500 focus:border-[#E8461E]/60 focus:ring-4 focus:ring-[#E8461E]/10"
            autoFocus
          />
          <p className="mt-2 text-xs text-gray-500">
            Supported: socks5://user:pass@host:port, host:port:user:pass, host:port
          </p>
        </div>
      </form>
    </Modal>
  )
}
