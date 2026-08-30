import { Check } from "lucide-react";

const steps = ["采集", "筛选", "成稿", "填入编辑器"];

export function WorkflowStepper({ active }: { active: number }) {
  return (
    <ol className="workflow-stepper" aria-label="工作流进度">
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const complete = stepNumber < active;
        const current = stepNumber === active;
        return (
          <li key={step} className={complete ? "complete" : current ? "current" : "waiting"}>
            <span className="step-node">{complete ? <Check size={15} /> : stepNumber}</span>
            <span className="step-label">{step}</span>
            {index < steps.length - 1 ? <span className="step-line" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

