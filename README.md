# BlueWing Group — Website (64 pages)

Every page is plain HTML. The header, menu, footer, icons and shared script come
from one set of files per site (see **Header, footer, icons and script** below).
Links and assets are root-relative (`/assets/...`), so view the site through a
local server or the Vercel deployment, not by opening the file.

## Contents

| Section | Pages |
|---|---|
| Group gateway | `index.html` |
| Company sites | `bluewing-dcpl` · `sygnific-infra` · `bhaarat-precast` |
| **Sectors** | `industrial` · `institutional` · `hotels` · `hospitals` · `residential` · `commercial` |
| Projects | `projects` · `projects-ongoing` · `projects-completed` + **33 detail pages** |
| Services | `epc-turnkey-projects` · `precast-products` |
| Corporate | `about-bluewing-dcpl` · `leadership-message` · `value-statement` · `quality-standards` · `safety-standards` · `careers` · `clients` |
| Editorial | `blog` + 4 article pages |
| Contact & legal | `contact-us` · `privacy-policy` · `cookies-policy` · `terms-conditions` |

## Latest round

**Banner photography removed site-wide.** The only remaining hero imagery is the four-slide project slider on `bluewing-dcpl.html`, which is untouched.

Every other banner is now a solid navy surface carrying a faint drafting grid that fades out before it reaches the type, plus a thin accent rule down the right edge. Because there is no photograph to compete with, the text shadows and gradient veils are gone — the type sits at full contrast on a flat ground.

The Sygnific Infra and Bhaarat Precast heroes lost their sliders too. In place of the slide caption, each now carries a statement panel: Sygnific states the Gujarat building-plus-diaphragm-wall position with panel thickness, clearance and stage count; Bhaarat states the facility with location, machinery and group verticals.

## Round before

- **Leadership Message**: intro headline now breaks in two lines (the 26ch measure was forcing five); both leader blocks share one fixed portrait aspect box (3:3.7, `object-position:50% 18%`) so Jagrut Vasoya's portrait matches Pankti Vasoya's regardless of source dimensions; the corner rule mirrors on the alternating row; closing "Join us today" band removed from this page only.
- **About BlueWing DCPL**: company timeline added — eight milestones from JP Design in 2013 to Bhaarat Precast in 2026, with the six turning points marked by a filled node and the substantive ones carrying a fact chip (ITC Narmada, 6L sq.ft., D-Wall PAN India, ISO 9001·14001·45001, 3 verticals). Collapses to a single left-rail layout below 640px.
- **Value Statement**: replaced with your six values — Teamwork, Customer Satisfaction, Continuous Improvement, Ownership, Quality, Safety. Each card shows the value, its principle line, and a sentence on what it means in practice.

## Round before

**Banner alignment — root cause found.** `.ph__in` and `.gw__in` each carried both `.shell` (max-width 1400 + auto margins) *and* their own narrower max-width. The narrower value won, so every banner rendered as a 900px column offset from the 1400px header container — which is why the alignment kept looking wrong after previous fixes. `.shell` now owns the container; the type is constrained with `max-width` on the `h1` and lede instead. Banners line up with the logo on every page.

Also this round:

- Homepage banner re-centred; every other banner left-aligned.
- "Selected work" heading and its supporting text top-aligned (`.pr .head{align-items:start}`).
- Leadership portraits reduced (column 0.42fr → 0.3fr, capped at 300px, corner rule 132px → 96px) and the intro headline held to two lines.
- Safety Standards and Careers: image added to the right of the opening section — a project photo and the team photo respectively. (Quality Standards was reverted to its previous single-column layout at your request; the injected figure had landed inside the certification badge grid.)
- "How to apply" removed from Careers; "Insights & News" removed from the About dropdown.
- Industrial: Solutions heading shortened and broken across two lines.
- **Full article published** for the automation-ready warehouse post — 1,074 words, 9 sections, 58 bullets, 8 FAQs in an accordion, author byline and tag chips. This is the article template; say the word and the other posts follow.

**Responsive audit:** 39 multi-column grids checked — all have a `max-width` breakpoint. No genuine fixed widths above 360px anywhere, viewport meta present on all 64 pages, no `maximum-scale` zoom lock, `overflow-x` guarded.

## Round before

**BlueWing 2026 SVG logo** now used in the navigation bar, the mobile drawer and the footer, replacing the raster PNGs entirely — no `.png` logo references remain anywhere.

It is embedded once per page as an SVG sprite symbol (`#bw-logo`) rather than linked as a file, so it renders even if a page is opened on its own. The wordmark's flat `#2C2D3B` fill was rebound to `currentColor`, which means the same single asset serves the white header, the white footer and the dark BlueWing DCPL hero — the hero simply sets `color:#fff` and the mark reverses. The embedded Arial subset for the ® glyph is retained; the decorative baseline rule at the foot of the artboard is dropped, since it reads as a stray line at navigation scale.

The original file is also kept at `assets/BlueWing-logo-2026.svg` for use elsewhere.

## Round before

- **Poppins throughout** — display, body and label roles all set in Poppins (300–700). Heading tracking eased from −0.032em to −0.024em and the hero scale trimmed, because Poppins sets optically larger and rounder than Archivo did.
- **One logo in header and footer** — `BWDCPL-logo_Website.png`. The reversed mark (`blu-new-logo.png`) is retained only on the dark BlueWing DCPL hero, where a dark logo would disappear.
- **Footer inverted to white** with dark text, a hairline top border, and blue link hovers. Removed from the dark-context accent list so labels use the full-strength `#34446F`.
- **Capabilities menu**: three equal columns; the six sectors now sit in a 3×2 grid under BlueWing DCPL.
- **All banners left-aligned** to the container, homepage included.
- **Project status chips** are one colour for both Ongoing and Completed — the filter above the grid already carries that distinction.
- **Bhaarat Precast**: form removed from the second-to-last section, which is now "Working with Bhaarat Precast" — the four assurance points plus two CTAs. Enquiries route to the contact page.

## Previous round

- **About dropdown narrowed** to 600px (was sharing the 1020px Capabilities width) and reduced to two even columns.
- **Sector chips in the Capabilities menu now sit on one line** — `nowrap`, smaller type, tighter tracking.
- **All seven About-menu pages redesigned** with graphic elements: a blueprint-grid motif (`.gfx`), outlined numeral section markers (`.mark`), icon value cards, numbered protocol grids and a certification badge row.
- **Leadership Message rebuilt from your staging content** — both messages in full, with portraits of Jagrut Vasoya (Founder & CMD) and Pankti Vasoya (Director) and their pull-quotes.
- **Precast Products page built from the real specifications** — hollow core slab, wall panels, columns, beams, staircases & landings, U drains. Each with thickness/width ranges, mould specification and key advantages, in an alternating image/spec layout. Linked from the Bhaarat page, its component cards, and the Capabilities menu.
- **Banner text left-aligned** to the content column on every page except the homepage, which stays centred.
- **Company hero banners reduced** — min-height 88vh → 70vh, hero type scale down, logo 56px → 46px.
- **"Join Us Today" redesigned** — contact details removed, replaced by three assurance rows (ISO certification, 2-day response, single-contract accountability).
- **Project photos added** to all 33 detail pages: a wide lead image plus a three-up grid.

## Earlier round

**Six sector pages rebuilt from your staging content** — headline, both
paragraphs, the four value pillars and the project list are taken verbatim
from each staging page. Industrial also carries its four Industrial Solutions
cards and all seven Industries We Serve; Hospitals, Residential and Commercial
carry their focus-card blocks.

**33 project detail pages, up from 16.** The sector pages revealed 17 projects
that were not on the DCPL homepage: RM Engineering, Organic Industries, Metro
Metaliks, AR Auto, Saurashtra Leuva Patel Samaj Trust, Aquatics Gallery,
Rajpath Club, three OYO properties, ITC Hotel, Rameshwar Sky, Mulsana and
Kanjari and Gokul farmhouses, Aura Luxuria and GSRTC Rajkot. Each now has a
detail page, and every sector grid links to real pages.

**Contact page now carries two forms** behind a tab switcher: *Project enquiry*
and *Vendor registration* (company, contact, email, phone, category of supply,
city, GST, years trading, website, products offered). Arrow-key navigable,
`role="tablist"`, one submit handler shared.

## Two things I corrected

- The staging URL and H1 for Commercial read **"Commerical"**. Spelled
  correctly here — fix the slug before launch or set a redirect.
- On the Residential page the four space-type labels sit against **mismatched
  images** (Staff Quarters shows the apartments image, etc.). Re-paired.

## Still using my draft copy — send me the real text

These six pages were written before you sent their source links, so they are
my drafts, not your content: `about-bluewing-dcpl`, `leadership-message`,
`clients`, `quality-standards`, `safety-standards`, `careers`. I ran out of
room this round to pull all thirteen source pages. Send those six and I will
swap the copy in — the layouts are already built.

## Also still needed

- Real figures: area constructed, client count, years (marked `TODO`)
- Per-project area, duration, client and dates — details read "On request"
- Dark logo variants (SVG) for the white header
- Real testimonials, and legal review of the three policy pages

## Header, footer, icons and script

Each site (`bluewing`, `bhaaratprecast`, `sygnificinfra`, `alutek`) has its own files:

| File | What it holds |
|---|---|
| `<site>/_layout/header.html` | Header and mobile menu |
| `<site>/_layout/footer.html` | Footer |
| `<site>/assets/icons.svg` | Every icon (pages use `<use href="/assets/icons.svg#i-arr">`) |
| `<site>/assets/js/site.js` | Menu, header, sliders, forms and logo script for every page |

To change the header or footer, edit the site's `_layout` file, then run:

```
node scripts/build-layout.js
```

It copies the header and footer into every page of that site, between the
`<!-- layout:header -->` and `<!-- layout:footer -->` markers, and commits nothing
by itself. Commit the pages it changes. `node scripts/build-layout.js --check`
lists pages that are out of date.

- The marker sets the menu item marked as the current page:
  `<!-- layout:header current="/projects.html" -->`. The BlueWing DCPL page adds
  `cobrand="BlueWing DCPL"`.
- Run the script after editing `icons.svg` or `site.js` too. It stamps
  `?v=<hash>` on their links. Browsers keep these two files cached (see
  `headers` in `vercel.json`), so a change reaches visitors only through a new
  `?v=`.
- `contact-us.html` on each site keeps its own inline copy of the script (it has
  the phone-code form) and does not load `site.js`.
- `_layout` folders are not deployed (`.vercelignore`).
