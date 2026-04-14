# CLAUDE.md - Experiment App

**IMPORTANT: You are working in `/experiment`. The code in `/backend` and `/frontend` is NOT relevant to this project.**

This is a separate Next.js application for experimentation. It does not depend on or interact with the main writing-tools app.

## Quick Facts

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Package Manager**: `npm` (NOT `uv`)
- **Styling**: Tailwind CSS
- **AI Integration**: Vercel AI SDK + OpenAI

## Experiment Overview

This is a "measuring thinking" experiment studying how writers use AI assistance and information-seeking behavior.

### Core Research Question

This experiment investigates **over-reliance on AI writing suggestions**. When people receive AI-generated text, they risk "premature closure"—accepting plausible-sounding output without thinking through what the situation actually requires.

### Measurement Approach

We measure over-reliance through two channels:
1. **Process**: What questions participants ask the colleague (reveals what they thought to think about)
2. **Outcome**: Whether the final email reflects genuine understanding (care for recipient, consequences considered) vs. superficially professional but problem-unaware text

### The Colleague Chat as Measurement Instrument

The colleague serves dual purposes:
- **Realistic information source**: Writers need details to compose a good email
- **Measurement instrument**: Questions asked reveal cognitive engagement

**Critical constraint**: The colleague must NOT volunteer information proactively. If the LLM dumps all relevant facts without being asked, we can't measure what the participant thought to ask about. The colleague should be reactive, answering questions when asked but not anticipating needs. The system prompt includes "DON'T be proactive" for this reason.

### Research Goals
1. **AI Writing Assistance**: Measure how participants use different types of AI suggestions (complete drafts, example sentences, analysis questions, etc.)
2. **Information-Seeking**: Measure whether participants ask questions to gather information needed for their task
3. **Company Reputation Awareness**: Measure whether participants consider how their writing reflects on the company

### Task Scenarios
The experiment supports multiple configurable scenarios. Each scenario includes a unique colleague, recipient, and situation. Key design decisions:
- **Information gap**: The colleague's initial messages explain the problem but don't specify all details, encouraging participants to ask questions
- **Company framing**: Task instructions and colleague messages emphasize representing the company professionally
- **Follow-up nudge**: If participants don't engage with the chat, the colleague sends a brief follow-up after ~75 seconds (e.g., "still here if you need anything")—this is a conversation nudge, NOT an information dump

**Available Scenarios:**
1. **Room Double-Booking** (`roomDoubleBooking`): Event coordinator Sarah Martinez asks you to email panelist Jaden Thompson about a scheduling conflict
2. **Demo Rescheduling** (`demoRescheduling`): Solutions Engineer Marcus Chen asks you to email client Dr. Lisa Patel about rescheduling a product demo due to a critical bug

### Study Conditions
- `n` = no_ai (baseline - no AI suggestions)
- `c` = complete_document (AI suggests full email)
- `e` = example_sentences (AI gives example text)
- `a` = analysis_readerPerspective (AI asks reader perspective questions)
- `p` = proposal_advice (AI gives advice on next words)

## Key File Locations

### Study Flow (in order)
1. `components/study/ConsentPage.tsx` - Consent form
2. `components/study/IntroPage.tsx` - Study introduction
3. `components/study/IntroSurvey.tsx` - Pre-task survey
4. `components/study/StartTaskPage.tsx` - Task instructions (mentions chat, company framing)
5. `components/study/TaskPage.tsx` - Main writing task with chat + AI panels
6. `components/study/PostTaskSurvey.tsx` - Post-task survey
7. `components/study/FinalPage.tsx` - Completion page

### Core Components
- `components/ChatPanel.tsx` - Chat with simulated colleague (persona varies by scenario)
- `components/WritingArea.tsx` - Email composition area
- `components/AIPanel.tsx` - AI writing suggestions (varies by condition)

### Configuration
- `lib/studyConfig.ts` - Study page order, conditions, timing, **scenario definitions**
- `lib/messageTiming.ts` - Realistic chat timing calculations
- `lib/logging.ts` - Event logging utilities

### API Routes
- `app/api/chat/route.ts` - Chat endpoint (GPT-5.2 with scenario-specific system prompt)
- `app/api/writing-support/route.ts` - AI writing suggestions
- `app/api/log/route.ts` - Event logging endpoint

### Pages (IMPORTANT: Don't confuse these!)
- `app/page.tsx` - **Standalone demo** for AI writing assistance only (NO chat, NOT used in study)
- `components/study/TaskPage.tsx` - **Actual study task page** with collapsible chat + AI panel

### Timing for the Simulated Colleague

Realistic timing works as follows: The colleague finds a moment to read your message (~400-800ms), takes time to read and think through a response (depends on your message length), types an answer (depends on their response length), then sends it. The thinking/reading delay and typing duration both use the same calculation (40-80 chars/sec ± 300ms variation) but applied to different message lengths—they think proportionally to what you wrote, and type proportionally to what they're typing. This creates natural pacing.

### Adding New Scenarios

To add a new scenario, edit `lib/studyConfig.ts` and add a new entry to the `SCENARIOS` object. Each scenario requires:
- **colleague**: name, firstName, role
- **recipient**: name, email
- **taskInstructions**: title, description, companyFraming
- **chat**: initialMessages, followUpMessage, systemPrompt

Then pass the scenario ID via URL: `?scenario=yourScenarioId`


## Getting Started

```bash
cd experiment
npm install
```

Create `.env.local`:
```
OPENAI_API_KEY=sk-...
```

Run dev server:
```bash
npm run dev
```

Open http://localhost:3000

## Project Structure

```
experiment/
├── app/
│   ├── api/           # API routes (chat, writing-support)
│   ├── layout.tsx     # Root layout
│   └── page.tsx       # Main page
├── components/        # React components
├── contexts/          # Context providers
├── lib/               # Utilities
├── types/             # TypeScript types
└── package.json
```

## Testing

```bash
npm run test        # Run tests with vitest
```

## Common Commands

```bash
npm run dev         # Development server
npm run build       # Build for production
npm run lint        # Run ESLint
npm test            # Run tests
```

## Linting & Formatting

- **Import sorting** is handled automatically by Biome on save. Don't manually fix import sorting warnings—they resolve automatically.

## Key Files

- **API Routes**: `app/api/` (chat, writing-support endpoints)
- **Demo Page**: `app/page.tsx` (standalone AI demo, NO chat)
- **Study Task Page**: `components/study/TaskPage.tsx` (the actual study with chat)
- **Components**: `components/` folder

See `README.md` for more details on features and API documentation.

<!-- NEXT-AGENTS-MD-START -->[Next.js Docs Index]|root: ./.next-docs|STOP. What you remember about Next.js is WRONG for this project. Always search docs and read before any task.|If docs missing, run this command first: npx @next/codemod agents-md --output CLAUDE.md|01-app:{04-glossary.mdx}|01-app/01-getting-started:{01-installation.mdx,02-project-structure.mdx,03-layouts-and-pages.mdx,04-linking-and-navigating.mdx,05-server-and-client-components.mdx,06-cache-components.mdx,07-fetching-data.mdx,08-updating-data.mdx,09-caching-and-revalidating.mdx,10-error-handling.mdx,11-css.mdx,12-images.mdx,13-fonts.mdx,14-metadata-and-og-images.mdx,15-route-handlers.mdx,16-proxy.mdx,17-deploying.mdx,18-upgrading.mdx}|01-app/02-guides:{ai-agents.mdx,analytics.mdx,authentication.mdx,backend-for-frontend.mdx,caching.mdx,ci-build-caching.mdx,content-security-policy.mdx,css-in-js.mdx,custom-server.mdx,data-security.mdx,debugging.mdx,draft-mode.mdx,environment-variables.mdx,forms.mdx,incremental-static-regeneration.mdx,instrumentation.mdx,internationalization.mdx,json-ld.mdx,lazy-loading.mdx,local-development.mdx,mcp.mdx,mdx.mdx,memory-usage.mdx,multi-tenant.mdx,multi-zones.mdx,open-telemetry.mdx,package-bundling.mdx,prefetching.mdx,production-checklist.mdx,progressive-web-apps.mdx,public-static-pages.mdx,redirecting.mdx,sass.mdx,scripts.mdx,self-hosting.mdx,single-page-applications.mdx,static-exports.mdx,tailwind-v3-css.mdx,third-party-libraries.mdx,videos.mdx}|01-app/02-guides/migrating:{app-router-migration.mdx,from-create-react-app.mdx,from-vite.mdx}|01-app/02-guides/testing:{cypress.mdx,jest.mdx,playwright.mdx,vitest.mdx}|01-app/02-guides/upgrading:{codemods.mdx,version-14.mdx,version-15.mdx,version-16.mdx}|01-app/03-api-reference:{07-edge.mdx,08-turbopack.mdx}|01-app/03-api-reference/01-directives:{use-cache-private.mdx,use-cache-remote.mdx,use-cache.mdx,use-client.mdx,use-server.mdx}|01-app/03-api-reference/02-components:{font.mdx,form.mdx,image.mdx,link.mdx,script.mdx}|01-app/03-api-reference/03-file-conventions/01-metadata:{app-icons.mdx,manifest.mdx,opengraph-image.mdx,robots.mdx,sitemap.mdx}|01-app/03-api-reference/03-file-conventions:{default.mdx,dynamic-routes.mdx,error.mdx,forbidden.mdx,instrumentation-client.mdx,instrumentation.mdx,intercepting-routes.mdx,layout.mdx,loading.mdx,mdx-components.mdx,not-found.mdx,page.mdx,parallel-routes.mdx,proxy.mdx,public-folder.mdx,route-groups.mdx,route-segment-config.mdx,route.mdx,src-folder.mdx,template.mdx,unauthorized.mdx}|01-app/03-api-reference/04-functions:{after.mdx,cacheLife.mdx,cacheTag.mdx,connection.mdx,cookies.mdx,draft-mode.mdx,fetch.mdx,forbidden.mdx,generate-image-metadata.mdx,generate-metadata.mdx,generate-sitemaps.mdx,generate-static-params.mdx,generate-viewport.mdx,headers.mdx,image-response.mdx,next-request.mdx,next-response.mdx,not-found.mdx,permanentRedirect.mdx,redirect.mdx,refresh.mdx,revalidatePath.mdx,revalidateTag.mdx,unauthorized.mdx,unstable_cache.mdx,unstable_noStore.mdx,unstable_rethrow.mdx,updateTag.mdx,use-link-status.mdx,use-params.mdx,use-pathname.mdx,use-report-web-vitals.mdx,use-router.mdx,use-search-params.mdx,use-selected-layout-segment.mdx,use-selected-layout-segments.mdx,userAgent.mdx}|01-app/03-api-reference/05-config/01-next-config-js:{adapterPath.mdx,allowedDevOrigins.mdx,appDir.mdx,assetPrefix.mdx,authInterrupts.mdx,basePath.mdx,browserDebugInfoInTerminal.mdx,cacheComponents.mdx,cacheHandlers.mdx,cacheLife.mdx,compress.mdx,crossOrigin.mdx,cssChunking.mdx,deploymentId.mdx,devIndicators.mdx,distDir.mdx,env.mdx,expireTime.mdx,exportPathMap.mdx,generateBuildId.mdx,generateEtags.mdx,headers.mdx,htmlLimitedBots.mdx,httpAgentOptions.mdx,images.mdx,incrementalCacheHandlerPath.mdx,inlineCss.mdx,isolatedDevBuild.mdx,logging.mdx,mdxRs.mdx,onDemandEntries.mdx,optimizePackageImports.mdx,output.mdx,pageExtensions.mdx,poweredByHeader.mdx,productionBrowserSourceMaps.mdx,proxyClientMaxBodySize.mdx,reactCompiler.mdx,reactMaxHeadersLength.mdx,reactStrictMode.mdx,redirects.mdx,rewrites.mdx,sassOptions.mdx,serverActions.mdx,serverComponentsHmrCache.mdx,serverExternalPackages.mdx,staleTimes.mdx,staticGeneration.mdx,taint.mdx,trailingSlash.mdx,transpilePackages.mdx,turbopack.mdx,turbopackFileSystemCache.mdx,typedRoutes.mdx,typescript.mdx,urlImports.mdx,useLightningcss.mdx,viewTransition.mdx,webVitalsAttribution.mdx,webpack.mdx}|01-app/03-api-reference/05-config:{02-typescript.mdx,03-eslint.mdx}|01-app/03-api-reference/06-cli:{create-next-app.mdx,next.mdx}|02-pages/01-getting-started:{01-installation.mdx,02-project-structure.mdx,04-images.mdx,05-fonts.mdx,06-css.mdx,11-deploying.mdx}|02-pages/02-guides:{analytics.mdx,authentication.mdx,babel.mdx,ci-build-caching.mdx,content-security-policy.mdx,css-in-js.mdx,custom-server.mdx,debugging.mdx,draft-mode.mdx,environment-variables.mdx,forms.mdx,incremental-static-regeneration.mdx,instrumentation.mdx,internationalization.mdx,lazy-loading.mdx,mdx.mdx,multi-zones.mdx,open-telemetry.mdx,package-bundling.mdx,post-css.mdx,preview-mode.mdx,production-checklist.mdx,redirecting.mdx,sass.mdx,scripts.mdx,self-hosting.mdx,static-exports.mdx,tailwind-v3-css.mdx,third-party-libraries.mdx}|02-pages/02-guides/migrating:{app-router-migration.mdx,from-create-react-app.mdx,from-vite.mdx}|02-pages/02-guides/testing:{cypress.mdx,jest.mdx,playwright.mdx,vitest.mdx}|02-pages/02-guides/upgrading:{codemods.mdx,version-10.mdx,version-11.mdx,version-12.mdx,version-13.mdx,version-14.mdx,version-9.mdx}|02-pages/03-building-your-application/01-routing:{01-pages-and-layouts.mdx,02-dynamic-routes.mdx,03-linking-and-navigating.mdx,05-custom-app.mdx,06-custom-document.mdx,07-api-routes.mdx,08-custom-error.mdx}|02-pages/03-building-your-application/02-rendering:{01-server-side-rendering.mdx,02-static-site-generation.mdx,04-automatic-static-optimization.mdx,05-client-side-rendering.mdx}|02-pages/03-building-your-application/03-data-fetching:{01-get-static-props.mdx,02-get-static-paths.mdx,03-forms-and-mutations.mdx,03-get-server-side-props.mdx,05-client-side.mdx}|02-pages/03-building-your-application/06-configuring:{12-error-handling.mdx}|02-pages/04-api-reference:{06-edge.mdx,08-turbopack.mdx}|02-pages/04-api-reference/01-components:{font.mdx,form.mdx,head.mdx,image-legacy.mdx,image.mdx,link.mdx,script.mdx}|02-pages/04-api-reference/02-file-conventions:{instrumentation.mdx,proxy.mdx,public-folder.mdx,src-folder.mdx}|02-pages/04-api-reference/03-functions:{get-initial-props.mdx,get-server-side-props.mdx,get-static-paths.mdx,get-static-props.mdx,next-request.mdx,next-response.mdx,use-params.mdx,use-report-web-vitals.mdx,use-router.mdx,use-search-params.mdx,userAgent.mdx}|02-pages/04-api-reference/04-config/01-next-config-js:{adapterPath.mdx,allowedDevOrigins.mdx,assetPrefix.mdx,basePath.mdx,bundlePagesRouterDependencies.mdx,compress.mdx,crossOrigin.mdx,deploymentId.mdx,devIndicators.mdx,distDir.mdx,env.mdx,exportPathMap.mdx,generateBuildId.mdx,generateEtags.mdx,headers.mdx,httpAgentOptions.mdx,images.mdx,isolatedDevBuild.mdx,onDemandEntries.mdx,optimizePackageImports.mdx,output.mdx,pageExtensions.mdx,poweredByHeader.mdx,productionBrowserSourceMaps.mdx,proxyClientMaxBodySize.mdx,reactStrictMode.mdx,redirects.mdx,rewrites.mdx,serverExternalPackages.mdx,trailingSlash.mdx,transpilePackages.mdx,turbopack.mdx,typescript.mdx,urlImports.mdx,useLightningcss.mdx,webVitalsAttribution.mdx,webpack.mdx}|02-pages/04-api-reference/04-config:{01-typescript.mdx,02-eslint.mdx}|02-pages/04-api-reference/05-cli:{create-next-app.mdx,next.mdx}|03-architecture:{accessibility.mdx,fast-refresh.mdx,nextjs-compiler.mdx,supported-browsers.mdx}|04-community:{01-contribution-guide.mdx,02-rspack.mdx}<!-- NEXT-AGENTS-MD-END -->
