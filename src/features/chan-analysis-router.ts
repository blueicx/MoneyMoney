import express from 'express';
// @ts-ignore
import chanAnalysis from '../web/public/chart-analysis.js';

export const chanAnalysisRouter = express.Router();

chanAnalysisRouter.post('/analyze/chan', express.json(), (req, res) => {
  try {
    const { bars } = req.body;
    if (!Array.isArray(bars)) {
      return res.status(400).json({ success: false, error: 'Bars must be an array' });
    }
    const chanGraph = chanAnalysis.detectChanStructures(bars);
    res.json({ success: true, data: chanGraph });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

chanAnalysisRouter.post('/replay/step', express.json(), (req, res) => {
  try {
    const { currentIndex, length, action } = req.body;
    const nextIndex = chanAnalysis.stepReplay(currentIndex, length, action);
    res.json({ success: true, data: { nextIndex } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
