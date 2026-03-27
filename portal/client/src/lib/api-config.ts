// FastAPI backend URL — the pipeline service
export const PIPELINE_API = import.meta.env.VITE_PIPELINE_API || "https://alpha-pipeline-api.onrender.com";

// Portal backend URL — for term sheet HTML generation (only when running on Render)
export const PORTAL_API = import.meta.env.VITE_PORTAL_API || "";
