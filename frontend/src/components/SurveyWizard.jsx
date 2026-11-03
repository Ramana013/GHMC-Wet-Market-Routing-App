import React, { useState, useMemo } from 'react';
import axios from 'axios';
import surveyConfig from "../surveyConfig.json";

const API = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

// Helper: Group questions into sections based on their prefix (General, A, B, C...)
const sections = [];
let currentSection = { title: "General", questions: [] };

surveyConfig.forEach((item) => {
  // Find section boundaries
  if (item.id.startsWith('q_') && item.id.length >= 4) {
    const domainLetter = item.id[2].toUpperCase();
    if (currentSection.title !== `Domain ${domainLetter}`) {
      if (currentSection.questions.length > 0) sections.push(currentSection);
      currentSection = { title: `Domain ${domainLetter}`, questions: [] };
    }
  }
  currentSection.questions.push(item);
});
if (currentSection.questions.length > 0) sections.push(currentSection);

export default function SurveyWizard({ shop, onClose, onSuccess }) {
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [answers, setAnswers] = useState({
    market_shop_name: shop.title || '', // Auto-fill shop name
    site_geotag: `${shop.lat} ${shop.lng} 0 0` // Auto-fill GPS
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (id, value) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
  };

  // Evaluate XPath formulas (Very basic evaluator for Kobo formulas)
  const evaluateCalculations = () => {
    const evaluated = { ...answers };

    // Loop through all calculate items
    surveyConfig.forEach(item => {
      if (item.type === 'calculate' && item.calculation) {
        let formula = item.calculation;

        // Replace ${variable} with actual values
        formula = formula.replace(/\$\{([^}]+)\}/g, (match, varName) => {
          const val = evaluated[varName];
          return val !== undefined && val !== '' ? `"${val}"` : '""';
        });

        try {
          // Convert Kobo logic to JS logic
          formula = formula.replace(/ if\(/g, ' (')
                           .replace(/selected\(/g, '(')
                           .replace(/ div /g, ' / ')
                           .replace(/=' /g, '== '); // basic fix

          // Evaluate safely
          if (formula.includes('if(') || formula.includes('(')) {
             // Fallback safe evaluation
             const result = new Function('return ' + formula)();
             evaluated[item.id] = result;
          }
        } catch (e) {
          // Ignore math errors during typing
        }
      }
    });
    return evaluated;
  };

  const submitSurvey = async () => {
    setLoading(true);
    try {
      const finalAnswers = evaluateCalculations();

      // Get the calculated risk score from the form logic
      let riskPct = finalAnswers['overall_site_pct'] || 0;
      if (typeof riskPct !== 'number') riskPct = parseFloat(riskPct) || 0;

      let riskLevel = 'low';
      if (riskPct >= 75) riskLevel = 'critical';
      else if (riskPct >= 50) riskLevel = 'high';
      else if (riskPct >= 25) riskLevel = 'moderate';

      const payload = {
        enumerator_name: answers['enumerator'] || 'Unknown',
        assessment_date: answers['assessment_date'] || new Date().toISOString().split('T')[0],
        overall_risk_score: riskPct,
        overall_risk_level: riskLevel,
        survey_data: finalAnswers
      };

      await axios.post(`${API}/api/shops/${shop.id}/full-survey/`, payload);
      onSuccess();
      onClose();
    } catch (error) {
      console.error(error);
      alert('Failed to save survey. Check console.');
    } finally {
      setLoading(false);
    }
  };

  const currentSection = sections[currentSectionIndex];

  if (!currentSection) return null;

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div style={{ background: '#f8fafc', width: '95%', maxWidth: '800px', height: '90vh', borderRadius: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '15px 20px', background: '#1e293b', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px' }}>{shop.title}</h2>
            <div style={{ fontSize: '13px', color: '#94a3b8' }}>{currentSection.title} ({currentSectionIndex + 1} of {sections.length})</div>
          </div>
          <button onClick={onClose} style={{ background: '#ef4444', color: 'white', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
        </div>

        {/* Progress Bar */}
        <div style={{ width: '100%', height: '4px', background: '#334155' }}>
          <div style={{ width: `${((currentSectionIndex + 1) / sections.length) * 100}%`, height: '100%', background: '#10b981', transition: '0.3s' }}></div>
        </div>

        {/* Form Body */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          {currentSection.questions.map((q) => {
            // Skip calculations, notes, and hidden fields
            if (q.type === 'calculate' || q.type === 'note') return null;

            // Skip if the skip-logic applies (simplified B1 check)
            if (q.id.startsWith('q_c') && answers['q_b1'] !== 'yes') return null;

            return (
              <div key={q.id} style={{ marginBottom: '25px', background: 'white', padding: '15px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px', color: '#1e293b', fontSize: '15px' }}>
                  {q.label} {q.required && <span style={{ color: '#ef4444' }}>*</span>}
                </label>
                {q.hint && <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '12px' }}>{q.hint}</div>}

                {/* Render Inputs based on Kobo Type */}
                {(q.type === 'text' || q.type === 'integer' || q.type === 'decimal') ? (
                  <input
                    type={q.type === 'text' ? 'text' : 'number'}
                    value={answers[q.id] || ''}
                    onChange={(e) => handleChange(q.id, e.target.value)}
                    style={{ width: '100%', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '15px' }}
                  />
                ) : q.type === 'date' ? (
                  <input type="date" value={answers[q.id] || ''} onChange={(e) => handleChange(q.id, e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '15px' }} />
                ) : q.type === 'geopoint' ? (
                  <input type="text" value={answers[q.id] || ''} onChange={(e) => handleChange(q.id, e.target.value)} placeholder="lat lon" style={{ width: '100%', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '15px' }} />
                ) : q.type.startsWith('select_one') ? (
                  <select
                    value={answers[q.id] || ''}
                    onChange={(e) => handleChange(q.id, e.target.value)}
                    style={{ width: '100%', padding: '12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '15px', background: 'white' }}
                  >
                    <option value="">Select an option...</option>
                    {q.options?.map(opt => (
                      <option key={opt.name} value={opt.name}>{opt.label}</option>
                    ))}
                  </select>
                ) : q.type.startsWith('select_multiple') ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {q.options?.map(opt => (
                      <label key={opt.name} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontWeight: 'normal', fontSize: '14px', color: '#334155' }}>
                        <input type="checkbox"
                          checked={(answers[q.id] || []).includes(opt.name)}
                          onChange={(e) => {
                            const current = answers[q.id] || [];
                            const newVal = e.target.checked ? [...current, opt.name] : current.filter(v => v !== opt.name);
                            handleChange(q.id, newVal);
                          }}
                          style={{ width: '18px', height: '18px' }}
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Footer Navigation */}
        <div style={{ padding: '15px 20px', background: 'white', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between' }}>
          <button
            disabled={currentSectionIndex === 0 || loading}
            onClick={() => setCurrentSectionIndex(prev => prev - 1)}
            style={{ padding: '10px 20px', background: '#e2e8f0', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: currentSectionIndex === 0 ? 'not-allowed' : 'pointer', color: '#334155' }}
          >
            Previous
          </button>

          {currentSectionIndex < sections.length - 1 ? (
            <button
              onClick={() => setCurrentSectionIndex(prev => prev + 1)}
              style={{ padding: '10px 20px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              Next Section
            </button>
          ) : (
            <button
              onClick={submitSurvey}
              disabled={loading}
              style={{ padding: '10px 20px', background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}
            >
              {loading ? 'Saving Survey...' : 'Submit Survey'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}