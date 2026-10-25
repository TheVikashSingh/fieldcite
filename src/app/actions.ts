"use server";

import { headers } from "next/headers";
import { submitFreeScan, type FreeScanResult } from "../freescan/request";
import { clientIp, freeScanDeps } from "../freescan/server";

export type FreeScanFormState = FreeScanResult | null;

export async function requestFreeScan(_prev: FreeScanFormState, formData: FormData): Promise<FreeScanFormState> {
  const deps = freeScanDeps();
  if (!deps) return { ok: false, error: "paused", message: "Free scans aren't available right now. Please try again later." };
  const field = (name: string) => String(formData.get(name) ?? "");
  return submitFreeScan(
    {
      email: field("email"),
      domain: field("domain"),
      brandName: field("brandName"),
      categorySlug: field("categorySlug"),
      country: field("country"),
      competitors: formData.getAll("competitors").map(String),
      turnstileToken: field("cf-turnstile-response"),
      ip: clientIp(await headers()),
    },
    deps,
  );
}
