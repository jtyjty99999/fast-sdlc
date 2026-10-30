import type { StepRun } from '@autosdd/shared';
import { statusLabel } from '../../lib/format';

const TONE_CLASS: Record<string, string> = {
  SUCCEEDED: 'done',
  SKIPPED: 'done',
  RUNNING: 'active',
  READY: 'active',
  WAITING_APPROVAL: 'waiting',
  FAILED: 'failed',
};

interface StepperProps {
  steps: readonly StepRun[];
  selectedId: string | null;
  onSelect: (stepId: string) => void;
}

export function Stepper({ steps, selectedId, onSelect }: StepperProps) {
  return (
    <div className="stepper" role="list" aria-label="步骤进度">
      {steps.map((step, index) => (
        <button
          key={step.id}
          role="listitem"
          className={[
            'step-node',
            TONE_CLASS[step.status] ?? '',
            selectedId === step.id ? 'selected' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={() => onSelect(step.id)}
          title={`${step.stepName} · ${statusLabel(step.status)}`}
        >
          <span className="sn-top">
            {String(index + 1).padStart(2, '0')}
            <span>{statusLabel(step.status)}</span>
            {step.gateMode === 'HUMAN_APPROVAL' ? <span aria-hidden="true">◆</span> : null}
          </span>
          <span className="sn-name">{step.stepName}</span>
          <span className="sn-agent">{step.agentName}</span>
        </button>
      ))}
    </div>
  );
}
