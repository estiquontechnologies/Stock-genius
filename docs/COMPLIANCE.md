# Compliance checklist (for professional review)

**Status: not reviewed. Not ready for public launch.** This is an engineering summary of Indian legal and regulatory areas that appear relevant to Stock Genius as designed: a free, advertising-funded public website publishing Buy/Hold/Sell views on NSE/BSE stocks. It is not legal advice. Each item must be confirmed by qualified legal and compliance professionals against the **current** text of the rules. A disclaimer alone does not make the product compliant.

## 1. SEBI regulation of research and advice

| Area | Why it is relevant | Questions for counsel |
|---|---|---|
| **SEBI (Research Analysts) Regulations, 2014**, incl. the December 2024 amendments | The site publishes buy/sell/hold views on listed securities to the public. Being free to users does not obviously remove this; advertising revenue is a form of consideration. | Is RA registration required (individual, non-individual, part-time)? Qualified persons (NISM certification) and a compliance officer; research-report content and disclosures (conflicts, holdings, compensation, AI/model use); records retention (≥ 5 years); compliance audit; grievance redressal via SCORES; RAASB membership. Does the model-generated nature of views change anything? (The 2024 amendments keep the RA responsible for AI-tool output and require disclosure.) |
| **SEBI (Investment Advisers) Regulations, 2013** | Personalised advice needs IA registration. | Is the portfolio exposure lens sufficiently non-personalised? (It only describes user-entered holdings, gives no trade suggestions, and is kept separate from views.) |
| **SEBI circulars on finfluencers / unregistered entities (2024)** and later clarifications on education using recent market price data | Restricts regulated entities from associating with unregistered persons giving advice or return claims. Content claimed as “education” may not use recent price data. | Can the site operate before registration in any form? How does this affect partnerships, affiliate links and advertisers that are SEBI-regulated (brokers)? |
| **Advertisement code for RAs/IAs** | Rules on how a registered entity markets itself. | Review site copy, SEO text, social posts and app-store listings. |

**Design choices already made to reduce risk (for counsel to evaluate):**

- No “top picks”, rankings, return promises or urgency language. The overview shows only the *distribution* of views.
- Every view states its horizon, confidence (capped at 85/100) and risks, and is labelled “research signal, not a personal recommendation”.
- Facts, model analysis and user input are labelled separately. Sources and timestamps are shown.
- Point-in-time history and a server-side log of every displayed view (`recommendationLog` in the store) support record-keeping.
- No trade execution, no brokerage credentials, no personalised suggestions.

## 2. Options (F&O) content

- SEBI has repeatedly flagged losses among individual F&O traders (its September 2024 study reported about 93% of individual traders made net losses over FY22–FY24) and has tightened F&O rules for retail participation. Brokers must show risk disclosures; content that looks like F&O “tips” draws particular regulatory attention.
- Design choices already made: the options pages show **no Buy/Sell views, no trade ideas and no order placement**. A risk notice citing the SEBI study appears at the top of every options page. Example strategies in the payoff simulator are labelled as educational illustrations; the simulator ignores costs, taxes and margin and says so.
- Questions for counsel: Does analytics such as max pain, PCR and OI “levels” amount to research under the RA Regulations? Do the example strategies need further framing? What disclosures should accompany derived Greeks and implied volatility?
- Data: the NSE F&O bhavcopy has the same licensing considerations as other exchange data (section 4).

## 3. Advertising

- **Conflicts of interest:** advertisers could include brokers, trading apps, mutual funds or listed companies covered by the site. Recommended: block those categories in AdSense, disclose ad funding, and never accept direct sponsorship from covered companies.
- **Separation:** ads only in labelled slots, never inside views, evidence, risks or news. This is implemented.
- **Law and policies:** Consumer Protection Act 2019; CCPA guidelines on misleading advertisements and dark patterns (2022/2023); ASCI code; Google AdSense financial-services and personalisation policies.

## 4. Market-data licensing

| Source | Notes |
|---|---|
| NSE / BSE (bhavcopy, index files, index names) | Exchange website terms generally restrict automated access and redistribution. Public display of prices or index values on a commercial site normally needs a licence from the exchange or an authorised vendor. Index names (e.g. Nifty, SENSEX) are trademarks. |
| Upstox API | Data is for the account holder’s use; commercial redistribution requires agreement with Upstox. |
| FRED | Free API; some series are owned by third parties with their own terms; attribution required. |
| RSS publishers | Headlines link back to publishers; confirm each feed’s terms for commercial use. |

**Action:** obtain licences (version 2 “paid feeds”) before public, ad-supported operation. The automated collector is polite (once daily, sequential, delayed requests) but that does not grant permission.

## 5. Privacy and platform law

- **Digital Personal Data Protection Act, 2023** and DPDP Rules: notice, consent (including advertising cookies), purpose limitation, retention, security safeguards, breach reporting, data-principal rights, grievance officer. The current build is single-user and stores watchlists, theses, journal and holdings in a server file. Multi-user operation needs accounts, a database, encryption at rest, retention and deletion flows.
- **IT Act 2000 and IT (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021** if user-generated content is published.
- Terms of use, privacy policy, cookie policy, grievance-officer contact details, and an error-correction process.

## 6. Model governance

- Document rules, weights and sector assumptions (in-app Methodology page; `server/analysis/`). Version the model (`MODEL_VERSION`).
- Periodically review outcomes vs views. Record reviews and changes.
- Monitor data quality; show stale-data states (implemented); add an incident process for bad data.

## 7. Open engineering items before public launch

1. Authentication, user accounts, database, backups.
2. Rate limiting, logging/monitoring, HTTPS reverse proxy.
3. Licensed data feeds (prices for display, fundamentals, estimates, calendars).
4. Consent-management platform if serving users outside India (e.g. EEA requires a certified CMP for AdSense).
5. Legal review of all user-facing copy, including disclaimers, Methodology and Compliance pages.
