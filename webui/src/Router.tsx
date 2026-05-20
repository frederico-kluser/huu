import { useWsSession } from '@/lib/ws-context';
import {
  ApiKeyPage,
  BackendSelectorPage,
  ModelSelectorPage,
  PipelineAssistantPage,
  PipelineEditorPage,
  PipelineExportPage,
  PipelineImportCustomPage,
  PipelineImportPage,
  PipelineImportPastePage,
  RunPage,
  SavedPipelinesPage,
  SummaryPage,
  TimeoutPromptPage,
  WaitingPage,
  WelcomePage,
} from '@/pages';

export function Router() {
  const { screen, status } = useWsSession();

  if (!screen) return <WaitingPage status={status} />;

  // key on screen.kind so React remounts (fresh local state) on transition;
  // CSS `animate-fade-in` adds a subtle 200ms entrance.
  switch (screen.kind) {
    case 'welcome':
      return <Frame key="welcome"><WelcomePage /></Frame>;
    case 'pipeline-assistant':
      return <Frame key="pipeline-assistant"><PipelineAssistantPage /></Frame>;
    case 'pipeline-editor':
      return <Frame key="pipeline-editor"><PipelineEditorPage /></Frame>;
    case 'pipeline-import':
      return <Frame key="pipeline-import"><PipelineImportPage /></Frame>;
    case 'pipeline-import-paste':
      return <Frame key="pipeline-import-paste"><PipelineImportPastePage /></Frame>;
    case 'pipeline-import-custom':
      return <Frame key="pipeline-import-custom"><PipelineImportCustomPage /></Frame>;
    case 'pipeline-export':
      return <Frame key="pipeline-export"><PipelineExportPage /></Frame>;
    case 'saved-pipelines':
      return <Frame key="saved-pipelines"><SavedPipelinesPage /></Frame>;
    case 'backend-selector':
      return <Frame key="backend-selector"><BackendSelectorPage /></Frame>;
    case 'model-selector':
      return <Frame key="model-selector"><ModelSelectorPage backendKind={screen.backendKind} /></Frame>;
    case 'api-key':
      return <Frame key="api-key"><ApiKeyPage screen={screen} /></Frame>;
    case 'timeout-prompt':
      return <Frame key="timeout-prompt"><TimeoutPromptPage /></Frame>;
    case 'run':
      return <Frame key="run"><RunPage /></Frame>;
    case 'summary':
      return <Frame key="summary"><SummaryPage screen={screen} /></Frame>;
    default: {
      const _exhaustive: never = screen;
      return <div>Unknown screen: {JSON.stringify(_exhaustive)}</div>;
    }
  }
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-in">{children}</div>;
}
