# LOGITRACK-WAREHOUSER TIME EFFICINCY TRACKER SYSTEM

A full-stack warehouse workflow management system that tracks documents through multiple operational stages — from printing to final confirmation — with real-time status updates and an administrative dashboard for efficiency reporting.

## Overview

This system was built to digitize and streamline a warehouse's document-handling workflow. Every document ("Issue") moves through five sequential portals, and each portal updates the document's status in a shared database table. Supervisors get a live, centralized view of where every document stands and how efficiently each stage is performing.

## Tech Stack

- **Backend:** Java, Spring Boot, Maven, Hibernate (JPA) for ORM/database mapping, RESTful API
- **Frontend:** React (Vite)
- **Database:** MySQL, centered on a shared `Issue` entity mapped to a `document` table

## Deployment

- **Backend + MySQL Database:** Hosted on [Railway](https://railway.app)
- **Frontend:** Hosted on [Netlify](https://www.netlify.com)

## Architecture

The system is organized around a single shared `Issue` entity with portal-prefixed status fields (e.g. `printStatus`, `checkStatus`), so every portal reads and writes to the same underlying record as a document progresses.

### Workflow Portals

1. **Print Portal** – Handover → Start / Hold / End flow for the printing stage
2. **Pick Portal** – Picking stage of the workflow
3. **Check Portal** – Includes an Emergency Pick Error workflow with cross-portal notifications and resolution tracking
4. **Delivery Portal** – Table-based view with Delivered / Hold / Cancelled actions and an "Add to File" feature
5. **Confirm Portal** – Final confirmation stage, filtering by delivery status and stamping file numbers onto records

Each portal has a card-based, dark-themed UI with Start / Hold / End controls and automatic refresh, so operators always see the latest status without manual reloads.

### Admin Dashboard

- Efficiency reporting with donut charts and per-portal breakdowns
- Date-based filtering
- Report and System Configuration panels
- User & Division setup: manages login accounts, divisions, job categories, and named resource pools (pickers, printers, checkers, delivery staff, filers)
- Document file number management with date ranges

## Project Structure

```
company_project/
├── backend/    # Spring Boot application (Issue_*_Portal controllers, services, repositories)
└── frontend/   # React (Vite) application (src/pages/Issue_*_Portal/)
```

Backend controllers follow the `com.controller.Issue_*_Portal` package convention, with a clear separation between dedicated workflow endpoints and generic CRUD endpoints.

## Getting Started

### Prerequisites

- Java and Maven (for the Spring Boot backend)
- Node.js and npm (for the React frontend)
- MySQL database instance

### Backend

```bash
cd company_project/backend
# run with your preferred build tool, e.g.
mvn spring-boot:run
```

The backend runs on `http://localhost:8080` by default.

### Frontend

```bash
cd company_project/frontend
npm install
npm run dev
```

The frontend runs on `http://localhost:5173` by default.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
