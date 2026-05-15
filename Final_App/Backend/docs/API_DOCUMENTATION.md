# API Documentation

This document explains the core concepts behind the backend API framework, its structure, and how data flows through the application.

## 1. What is FastAPI?
FastAPI is a modern, fast (high-performance), web framework for building APIs with Python 3.7+ based on standard Python type hints. It is built on top of Starlette for the web parts and Pydantic for the data parts. In this project, it serves as the core framework powering the entire backend architecture.

## 2. Advantages of FastAPI
- **Extremely Fast:** It is one of the fastest Python frameworks available, on par with NodeJS and Go.
- **Fast to Code:** Increases the speed to develop features significantly.
- **Fewer Bugs:** Reduces human-induced errors by relying on Python type hints.
- **Intuitive:** Great editor support with autocompletion everywhere.
- **Robust:** Get production-ready code with automatic interactive documentation (Swagger UI and ReDoc).
- **Standards-based:** Fully compatible with open standards for APIs like OpenAPI and JSON Schema.

## 3. How GET and POST Methods Are Used Here
HTTP methods define the action to be performed on a specific resource. In this backend:

- **GET Methods:** Used to *retrieve* data without modifying any state on the server.
  - **Example:** `GET /` fetches the health status of the API.
  - **Example:** `GET /api/databricks-status` fetches the connection status with Databricks.
  - **Example:** `GET /api/dashboard-summary` queries Databricks and fetches analytical data for the dashboard.
  - **Example:** `GET /api/stream/dashboard` uses Server-Sent Events (SSE) to stream data continuously to the frontend.

- **POST Methods:** Used to *submit* data to the server, often creating or modifying a resource, or executing a complex operation.
  - **Example:** `POST /query` submits a user's question in a JSON payload. The backend then processes this query using the AI and RAG handlers and returns a generated response.
  - **Example:** `POST /upload-documents` submits files (like `.pdf`, `.txt`, `.md`) to the server. The backend parses these files and indexes them in the vector database for Retrieval-Augmented Generation (RAG).

- **DELETE Methods:** Used to *remove* a resource.
  - **Example:** `DELETE /clear-documents` clears all indexed documents from the vector database.

## 4. Structure of the API
The API is designed with a modular structure, separating concerns into different routers:

- **Main Application (`main.py`):** Initializes the FastAPI app, configures CORS (Cross-Origin Resource Sharing), and defines core endpoints like health checks (`/`) and AI/RAG endpoints (`/query`, `/upload-documents`).
- **Streaming Router (`sendData.py`):** Prefixed with `/api/stream`. It handles streaming responses for real-time dashboard updates (e.g., `/api/stream/dashboard`, `/api/stream/inventory`).
- **Analytics Router (`databricks_analytics.py`):** Handles all analytical data endpoints (e.g., `/api/dashboard-summary`, `/api/demand-intelligence`). These endpoints are responsible for serving aggregated data and insights.

## 5. How Data is Fetching and Processed
Data fetching in this application happens across three primary channels:

### A. Analytical Data via Databricks
When a frontend component requests analytical data (e.g., `GET /api/dashboard-summary`), the request routes to `databricks_analytics.py`.
1. The backend constructs a complex SQL query targeting specific "Gold" tables (e.g., `gold_all_features_combined`) in Databricks.
2. It uses `databricks_client.py` to connect to the Databricks SQL Warehouse and execute the query.
3. The raw rows returned are processed, clamped, and formatted into structured JSON responses containing KPIs, insights, and charts.

### B. AI and RAG (Retrieval-Augmented Generation) Queries
When a user asks a question via `POST /query`:
1. If RAG is enabled, the `RAGHandler` converts the query into an embedding and searches the local **Chroma DB vector store** for relevant document chunks.
2. The retrieved context (or just the query if RAG is off) is passed to the `AIHandler`.
3. The `AIHandler` sends a request to the **Hugging Face Inference API** (using models like DeepSeek), providing the context and the user's prompt.
4. The generated text is returned to the user along with the confidence score and source documents.

### C. Real-Time Streaming Data
For endpoints under `/api/stream/`:
1. The backend establishes a persistent connection with the client.
2. It uses Server-Sent Events (SSE) to yield data chunks periodically. This is particularly useful for live feeds, continuous risk monitoring, or real-time shipment tracking without the frontend needing to constantly poll the server.
