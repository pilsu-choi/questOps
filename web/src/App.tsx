import { Routes, Route } from "react-router-dom";
import { ToastProvider } from "./components/ui/Toast";
import ProjectList from "./pages/ProjectList";
import ProjectCreate from "./pages/ProjectCreate";
import Settings from "./pages/Settings";
import ProjectLayout from "./pages/ProjectLayout";
import Dashboard from "./pages/Dashboard";
import DocumentsAnalysis from "./pages/DocumentsAnalysis";
import InterviewQuestionnaire from "./pages/InterviewQuestionnaire";
import InterviewAnswers from "./pages/InterviewAnswers";
import DemoBuilder from "./pages/DemoBuilder";
import PresentationBuilder from "./pages/PresentationBuilder";
import StubStage from "./pages/StubStage";

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<ProjectList />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/projects/new" element={<ProjectCreate />} />
        <Route path="/projects/:id" element={<ProjectLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="docs" element={<DocumentsAnalysis />} />
          <Route path="interview" element={<InterviewQuestionnaire />} />
          <Route path="interview/answers" element={<InterviewAnswers />} />
          <Route path="demo" element={<DemoBuilder />} />
          <Route path="presentation" element={<PresentationBuilder />} />
          <Route path="requirements" element={<StubStage stage="requirements" />} />
          <Route path="prd" element={<StubStage stage="prd" />} />
          <Route path="wbs" element={<StubStage stage="wbs" />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
