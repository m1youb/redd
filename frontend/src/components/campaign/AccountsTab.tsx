import { useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { campaignApi } from '../../api/campaign'
import { CAMPAIGN_DASHBOARD_QUERY_KEY, type AccountRole, type CampaignAccount } from './types'

interface AccountsTabProps {
  accounts: CampaignAccount[]
}

const roleOptions: AccountRole[] = ['customer', 'employee', 'inactive']

function getRoleClasses(role: AccountRole) {
  switch (role) {
    case 'customer':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300'
    case 'employee':
      return 'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-300'
    default:
      return 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
  }
}

export default function AccountsTab({ accounts }: AccountsTabProps) {
  const queryClient = useQueryClient()

  const setRoleMutation = useMutation({
    mutationFn: async ({ accountId, role }: { accountId: number; role: AccountRole }) =>
      campaignApi.setAccountRole(accountId, { role }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CAMPAIGN_DASHBOARD_QUERY_KEY })
    },
  })

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#E8461E]">Account Routing</p>
        <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">Assign campaign roles</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Set whether each account operates as a customer, employee, or remains inactive.</p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm shadow-black/20">
        <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.4fr)] gap-4 border-b border-gray-200 dark:border-gray-800 px-5 py-3 text-xs font-semibold uppercase tracking-[0.22em] text-gray-500 md:grid">
          <span>Username</span>
          <span>Role</span>
          <span>Actions</span>
        </div>

        <div className="divide-y divide-gray-200 dark:divide-gray-800 overflow-x-auto">
          {accounts.map((account) => {
            const currentRole = account.role ?? 'inactive'

            return (
              <div key={account.id} className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.4fr)] md:items-center">
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">u/{account.username}</p>
                  <p className="mt-1 text-xs text-gray-500">Status: {account.status}</p>
                </div>

                <div>
                  <span className={clsx('inline-flex rounded-full border px-3 py-1 text-xs font-medium capitalize', getRoleClasses(currentRole))}>
                    {currentRole}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {roleOptions.map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setRoleMutation.mutate({ accountId: account.id, role })}
                      disabled={setRoleMutation.isPending && setRoleMutation.variables?.accountId === account.id}
                      className={clsx(
                        'rounded-md border px-3 py-2 text-sm font-medium capitalize transition',
                        currentRole === role
                          ? 'border-[#E8461E]/30 bg-[#E8461E]/10 text-[#ff8c6d]'
                           : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 text-gray-700 dark:text-gray-300 hover:border-gray-400 dark:hover:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800',
                      )}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
