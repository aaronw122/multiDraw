import { useNavigate } from "react-router-dom";

export const DashboardPlaceholder = () => {
  const navigate = useNavigate();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        fontFamily: "system-ui, -apple-system, sans-serif",
        gap: "1rem",
      }}
    >
      <h1 style={{ fontSize: "2rem", margin: 0 }}>Excalibur</h1>
      <p style={{ color: "#666", margin: 0 }}>
        Dashboard &mdash; Coming Soon
      </p>
      <button
        type="button"
        onClick={() => {
          const testId = `test-${Date.now()}`;
          navigate(`/project/${testId}`);
        }}
        style={{
          marginTop: "1rem",
          padding: "0.75rem 1.5rem",
          fontSize: "1rem",
          borderRadius: "8px",
          border: "1px solid #ccc",
          background: "#6965db",
          color: "#fff",
          cursor: "pointer",
        }}
      >
        Create Test Project
      </button>
    </div>
  );
};
