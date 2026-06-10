// Web build: transparently re-exports from server-fns so production behaviour
// is unchanged. The vite.config.capacitor.ts aliases this module to
// one-api.capacitor.ts, which calls Netlify Functions instead.
export {
  fetchIndividualClaims,
  submitIndividualClaim,
  fetchClaimWorkspace,
  addClaimMessage,
  registerClaimDocument,
  getClaimDocumentUrl,
  getStorageUploadUrl,
  clientClearMustChangePassword,
} from '@/lib/server-fns'
