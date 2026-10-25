"use client";

import Script from "next/script";
import { useActionState, useState } from "react";
import { requestFreeScan, type FreeScanFormState } from "./actions";

interface CategoryOption {
  slug: string;
  name: string;
  brands: string[];
}

const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "UK", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
];
const MAX_COMPETITORS = 3;

export function FreeScanForm({ categories, turnstileSiteKey }: { categories: CategoryOption[]; turnstileSiteKey: string }) {
  const [state, action, pending] = useActionState<FreeScanFormState, FormData>(requestFreeScan, null);
  const [slug, setSlug] = useState(categories[0]?.slug ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const category = categories.find((c) => c.slug === slug);

  if (state?.ok) {
    return (
      <p role="status" className="site-success">
        Check your inbox. Confirm your email with the link we sent (it expires in 15 minutes) and your scan starts right away. The report takes about two
        minutes.
      </p>
    );
  }

  const toggle = (brand: string) =>
    setPicked((current) => (current.includes(brand) ? current.filter((b) => b !== brand) : current.length < MAX_COMPETITORS ? [...current, brand] : current));
  const fieldError = (name: string) =>
    state && !state.ok && state.field === name ? (
      <span className="site-error" id={`${name}-error`}>
        {state.message}
      </span>
    ) : null;

  return (
    <form action={action} className="site-form" aria-describedby="free-scan-note">
      {state && !state.ok && !state.field ? (
        <p role="alert" className="site-error">
          {state.message}
        </p>
      ) : null}

      <label htmlFor="email">Work email</label>
      <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
      {fieldError("email")}

      <label htmlFor="domain">Company website</label>
      <input id="domain" name="domain" placeholder="yourcompany.com" required maxLength={253} />
      {fieldError("domain")}

      <label htmlFor="brandName">Product name</label>
      <input id="brandName" name="brandName" placeholder="As buyers know it" required maxLength={80} />
      {fieldError("brandName")}

      <label htmlFor="categorySlug">Category</label>
      <select
        id="categorySlug"
        name="categorySlug"
        value={slug}
        onChange={(e) => {
          setSlug(e.target.value);
          setPicked([]);
        }}
      >
        {categories.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.name}
          </option>
        ))}
      </select>
      {fieldError("categorySlug")}

      <label htmlFor="country">Buyers in</label>
      <select id="country" name="country" defaultValue="US">
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
      {fieldError("country")}

      <fieldset>
        <legend>Competitors to watch (up to {MAX_COMPETITORS}, optional)</legend>
        <div className="site-checks">
          {category?.brands.map((brand) => (
            <label key={brand} className="site-check">
              <input
                type="checkbox"
                name="competitors"
                value={brand}
                checked={picked.includes(brand)}
                disabled={!picked.includes(brand) && picked.length >= MAX_COMPETITORS}
                onChange={() => toggle(brand)}
              />{" "}
              {brand}
            </label>
          ))}
        </div>
      </fieldset>
      {fieldError("competitors")}

      {turnstileSiteKey ? (
        <>
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
          <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />
        </>
      ) : null}

      <button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Get my free scan"}
      </button>
      <p id="free-scan-note" className="site-hint">
        Free: 5 buyer questions × ChatGPT, Perplexity and Gemini. One free scan per company and per email every 30 days. We email you a link to confirm.
      </p>
    </form>
  );
}
