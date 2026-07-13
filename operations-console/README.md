# TCML Operations Console — Infrastructure PoC

## PURPOSE
This directory contains the Infrastructure Proof of Concept (PoC) for the future Tri-Cities MediaLab Operations Console.

## BOUNDARY
- **STATUS**: Isolated Infrastructure Proof
- **AUTHORITY**: NONE. All production truth remains in AppSheet, Sheets, and Drive Folder Law.
- **ISOLATION**: This console does not interact with live production data.

## COMPONENTS
- `poc.html`: Minimal UI proof.
- `js/services/`: Client-side connection logic (PoC only).
- `netlify/functions/`: Server-side protected boundary (PoC only).

## SUCCESS CRITERIA
1. Secure connection to Firebase SQL Connect (Test Schema).
2. Read-only metadata proof from a controlled Drive folder.
3. Zero impact on the existing public website.
