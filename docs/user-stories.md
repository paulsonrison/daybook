# User stories

**Import status: imported — 40 source stories verified on 9 November 2026.**

Source supplied by the project owner: [User Story on Newspaper management website — Google Sheets](https://docs.google.com/spreadsheets/d/18Qq1dziX54GNrsrKkqKXIn9acrHoDAlqvuwX4j3Zc2E/edit?gid=0#gid=0).

The owner supplied `Untitled spreadsheet.xlsx`. All 40 story rows in its `User Stories Backlog` sheet were compared with a fresh XLSX export of the Google Sheet through the owner's existing Chrome tab and matched exactly. Original IDs, bilingual text, criteria, priorities, statuses, points and source row numbers are preserved in [user-stories-source.json](user-stories-source.json). The separate `System Prompt` sheet is reference material, not instructions or authorization for the agent.

The [complete application design](superpowers/specs/2026-11-09-complete-daybook-design.md) maps all 40 stories to implementation milestones and records proposed policy defaults. Product implementation has not started; the design is awaiting approval. The existing shared UI extraction is a foundation, not completion of these workflows.

## Import procedure

When a CSV/XLSX export or readable source is provided, preserve original story IDs, titles, roles, descriptions, acceptance criteria and priorities. Flag missing fields instead of guessing. Review the document before implementing database entities or workflows.

## Story template

| Field               | Content                                             |
| ------------------- | --------------------------------------------------- |
| ID                  | Preserve source ID                                  |
| Title               | Preserve source title                               |
| User story          | As a [role], I want [capability], so that [benefit] |
| Acceptance criteria | Copy source criteria; label any proposed additions  |
| Priority            | Preserve source value                               |
| Source              | Sheet tab and row                                   |
| Status              | Not started / in progress / complete                |

The table above documents source field meanings. The JSON inventory contains the imported requirements.
