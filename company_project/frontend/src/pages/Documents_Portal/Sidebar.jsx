import { useState, useEffect, useCallback } from "react";
import { fetchJobCategories } from "../../services/Documents_Portal/api";
import "./Sidebar.css";

// Drop-in replacement for the old hard-coded Sidebar.
// Reads job categories from Admin → Master Setup → Job Category, and
// groups them under the division each category belongs to — so adding a
// category in Admin makes it (and its division heading) show up here
// automatically, no code changes needed.
//
// Props:
//   selectedType    – currently active job category name (optional, for highlight)
//   setSelectedType – called with the category name when a button is clicked

const REFRESH_MS = 5000;

const Sidebar = ({ selectedType, setSelectedType }) => {
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    fetchJobCategories()
      .then(res => {
        setCategories(res.data || []);
        setError(null);
      })
      .catch(err => setError(err.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  // Group categories by division, preserving first-seen order.
  const groups = [];
  const groupIndex = {};
  categories.forEach(cat => {
    const division = cat.divisionName || "Unassigned Division";
    if (!(division in groupIndex)) {
      groupIndex[division] = groups.length;
      groups.push({ division, items: [] });
    }
    groups[groupIndex[division]].items.push(cat);
  });

  return (
    <div className="doc-sidebar">
      <div className="doc-sidebar-brand">
        <span className="doc-brand-mark">WT</span>
        <div className="doc-brand-text">
          <div className="doc-brand-title">WareHouse</div>
          <div className="doc-brand-subtitle">Time Tracker System</div>
        </div>
      </div>

      <button
        className={`doc-nav-btn doc-nav-summary ${selectedType === "Summary" ? "active" : ""}`}
        onClick={() => setSelectedType("Summary")}
      >
        <span className="doc-nav-dot" />
        Summary
      </button>

      {loading && <div className="doc-sidebar-status">Loading job categories…</div>}
      {error && <div className="doc-sidebar-status error">Couldn't load categories</div>}
      {!loading && !error && groups.length === 0 && (
        <div className="doc-sidebar-status">
          No job categories yet.<br />Add them in Admin → Master Setup → Job Category.
        </div>
      )}

      {groups.map(g => (
        <div className="doc-division-group" key={g.division}>
          <div className="doc-division-label">{g.division}</div>
          {g.items.map(cat => (
            <button
              key={cat.id}
              className={`doc-nav-btn ${selectedType === cat.categoryName ? "active" : ""}`}
              onClick={() => setSelectedType(cat.categoryName)}
            >
              {cat.categoryName}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
};

export default Sidebar;
