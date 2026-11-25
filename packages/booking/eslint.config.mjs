import { defineConfig } from "eslint/config";
import { sharedPackage } from "@mango/config/eslint/package";

// Not pure: bookOnline() is server-only and gets the service role's client
// from @mango/db. Still no app imports, no @/ alias.
export default defineConfig([...sharedPackage()]);
