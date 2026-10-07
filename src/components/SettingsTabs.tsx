interface SettingsTabsProps<T extends string> {
  id: string;
  label: string;
  value: T;
  tabs: readonly { id: T; label: string }[];
  onChange: (value: T) => void;
}

/** Keep inactive panels mounted so switching sections cannot discard a form. */
export function SettingsTabs<T extends string>({ id, label, value, tabs, onChange }: SettingsTabsProps<T>) {
  return <div className="settings-tabs" role="tablist" aria-label={label}>
    {tabs.map((tab, index) => <button
      key={tab.id}
      type="button"
      role="tab"
      id={`${id}-tab-${tab.id}`}
      aria-controls={`${id}-panel-${tab.id}`}
      aria-selected={value === tab.id}
      tabIndex={value === tab.id ? 0 : -1}
      onClick={() => onChange(tab.id)}
      onKeyDown={(event) => {
        const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
          : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
            : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : undefined;
        if (next === undefined) return;
        event.preventDefault();
        onChange(tabs[next].id);
        document.getElementById(`${id}-tab-${tabs[next].id}`)?.focus();
      }}
    >{tab.label}</button>)}
  </div>;
}
