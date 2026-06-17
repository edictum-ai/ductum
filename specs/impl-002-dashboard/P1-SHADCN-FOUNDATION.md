# P1: shadcn/ui + Tailwind Foundation

**Scope:** Replace Mantine with shadcn/ui + Tailwind CSS, responsive layout shell
**Package:** `packages/dashboard`
**Depends on:** None
**Deliverable:** Dashboard renders with shadcn layout, sidebar nav, mobile drawer

---

## Required Reading

- `specs/impl-002-dashboard/spec.md` (full spec)
- `packages/dashboard/src/components/Layout.tsx` (current layout — 32 lines)
- `packages/dashboard/src/components/Sidebar.tsx` (current sidebar — 77 lines)
- `packages/dashboard/src/main.tsx` (app entry — MantineProvider wrapping)
- `packages/dashboard/package.json` (current Mantine dependencies)

## Tasks

### 1. Install Tailwind CSS + shadcn/ui

Remove Mantine:
```bash
pnpm --filter @ductum/dashboard remove @mantine/core @mantine/hooks
```

Install Tailwind (verify versions on npmjs.com first, pin exact):
```bash
pnpm --filter @ductum/dashboard add tailwindcss@4.1.8 @tailwindcss/vite@4.1.8
```

Update `vite.config.ts` to add the Tailwind plugin:
```typescript
import tailwindcss from '@tailwindcss/vite'
// add to plugins: [react(), tailwindcss()]
```

Replace `src/index.css` with:
```css
@import "tailwindcss";
```

Initialize shadcn (pin version — do NOT use @latest per supply-chain rules):
```bash
cd packages/dashboard
pnpm dlx shadcn@2.5.0 init --defaults
```

Add base components (shadcn copies source files, no runtime dependency):
```bash
pnpm dlx shadcn@2.5.0 add button badge card table tabs dialog sheet input label textarea select separator breadcrumb navigation-menu tooltip
```

**Supply-chain note:** shadcn generates source files copied into `src/components/ui/`.
These are NOT npm dependencies — they're source code you own. The `shadcn` CLI
is only used at dev time to scaffold components. Verify the generated files
before committing. Do not add shadcn as a runtime dependency.

### 2. Rewrite Layout component

File: `src/components/Layout.tsx`

Responsive shell:
- Desktop (≥768px): fixed sidebar (220px) + main content
- Mobile (<768px): top bar with hamburger + Sheet drawer for nav

Use `useMediaQuery` from a simple hook (no Mantine hooks — write a 5-line custom hook or use `window.matchMedia`).

```typescript
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(query)
    setMatches(mql.matches)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [query])
  return matches
}
```

### 3. Rewrite Sidebar component

File: `src/components/Sidebar.tsx`

Two variants:
- `DesktopSidebar`: fixed aside with NavigationMenu items
- `MobileNav`: top bar with Sheet trigger (hamburger)

Nav items: Projects (/), Agents (/agents), Approvals (/approvals)
Factory name clickable → navigates to /
All items are proper links/buttons (not divs)

### 4. Update main.tsx

Remove `MantineProvider`. The app should just be:
```tsx
<QueryClientProvider>
  <BrowserRouter>
    <Routes>...</Routes>
  </BrowserRouter>
</QueryClientProvider>
```

### 5. Compatibility shim for existing pages

Do NOT delete or replace existing page files. P2 and P3 need them as port
targets (they read the current implementation to understand what to port).

Instead, create a thin Mantine-to-Tailwind shim so existing pages can render
without Mantine at build time. Create `src/lib/mantine-shim.tsx` that exports
no-op versions of the most-used Mantine components:

```tsx
// Minimal shims so existing pages compile during transition.
// P2 and P3 will rewrite each page to use shadcn directly.
export const Text = (p: any) => <span {...p} />
export const Badge = (p: any) => <span {...p} />
export const Card = (p: any) => <div {...p} />
// etc.
```

Update existing page imports from `@mantine/core` to `@/lib/mantine-shim`.
This lets the build succeed without destroying page logic. Pages will look
unstyled but functional until P2/P3 rewrite them.

## Verification

- [ ] `pnpm --filter @ductum/dashboard build` succeeds
- [ ] No Mantine imports remain
- [ ] Dashboard renders at localhost:5173 with sidebar
- [ ] Mobile: hamburger menu opens drawer at 390px width
- [ ] All nav items are keyboard-accessible (Tab + Enter)
- [ ] Factory name click navigates to /
