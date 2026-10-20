import type { PayloadRequest } from 'payload'

/**
 * Default `replace.access`: signed-in users of the admin user collection who may open the admin
 * panel. Custom admin views and endpoints are not covered by Payload's own admin access check.
 */
export const defaultReplaceAccess = async ({ req }: { req: PayloadRequest }): Promise<boolean> => {
  const { user } = req
  if (!user || user.collection !== req.payload.config.admin.user) {
    return false
  }
  const adminAccess = req.payload.collections[user.collection]?.config.access?.admin
  return adminAccess ? Boolean(await adminAccess({ req })) : true
}
