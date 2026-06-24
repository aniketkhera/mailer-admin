// Themed sign-in page factory. The consuming site does:
//   import { config } from '@/mailer-admin.config'
//   import { createLoginPage } from 'mailer-admin/admin/login/page'
//   export default createLoginPage(config)
//
// Renders a themed magic-link sign-in form (brand = cfg.brandName + ' ·
// Admin') that POSTs to /api/auth/magic-link. The error-code copy map is
// preserved from the donor. Canonical donor: squashtigers-v2
// (app/admin/login/page.tsx). Every brand color maps to cfg.theme.*;
// semantic success-green / error-red stay literal.

import type { MailerConfig, Theme } from '../../config'
import LoginClient from './LoginClient'

export function createLoginPage(cfg: MailerConfig) {
  return function AdminLoginPage() {
    return <LoginClient theme={cfg.theme} brandName={cfg.brandName} />
  }
}

export type { Theme }
