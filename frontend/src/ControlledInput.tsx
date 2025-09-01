import { atom, useAtom, useAtomValue } from "jotai";
import React from "react";

export const inputStateAtom = atom<Record<string, string>>({});

type ControlledInputProps = {
  name: string;
  multiline?: boolean;
  spying?: boolean;
  [key: string]: any;
};

export const ControlledInput = ({
    name,
    multiline,
    spying,
    ...props
  }: ControlledInputProps) => {
    const [state, setState] = useAtom(inputStateAtom);
    const curValue = state[name] || "";
    const setValue = (val: string) => {
        setState((prev: Record<string, string>) => ({ ...prev, [name]: val }));
    };
    const proto = multiline ? "textarea" : "input";
    const innerProps: Record<string, any> = {};
    if (!multiline) {
      innerProps.autoComplete = "off";
      innerProps.autoCorrect = "off";
      innerProps.autoCapitalize = "on";
      innerProps.spellCheck = "false";
    }
    innerProps.name = name;
    innerProps.onChange = (evt: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setValue(evt.target.value);
    };
    innerProps.value = curValue;
    if (spying) {
      innerProps.title = name;
    }
    return React.createElement(proto, { ...innerProps, ...props });
  };

interface Option {
  key: string;
  value: string;
}

export const OptionsInput = ({
    name,
    options,
    spying,
  }: {
    name: string;
    options: Option[] | string[];
    spying: boolean;
  }) => {
    const [state, setState] = useAtom(inputStateAtom);
    const choice = state[name] || "";
    options = options.map(option =>
      typeof option === "string" ? { key: option, value: option } : option
    );
    function change(newVal: string) {
      setState((prev: Record<string, string>) => ({ ...prev, [name]: newVal }));
    }
    return (
      <div>
        {options.map(({ key, value }) => (
          <label
            key={key}
            style={{
              background: "#f0f0f0",
              display: "block",
              margin: "3px 0",
              padding: "10px 3px",
              width: "100%",
            }}
            title={spying ? `${name}=${key}` : undefined}
          >
            <input
              type="radio"
              checked={choice === key}
              onChange={() => change(key)}
            />
            <span style={{ width: "100%" }}>{value}</span>
          </label>
        ))}
      </div>
    );
  };

export const LikertInput = ({
  name,
  levels,
  spying
}: {
  name: string;
  levels: string[];
  spying: boolean;
}) => {
    const [state, setState] = useAtom(inputStateAtom);
    const choice = state[name] || "";
    function change(newVal: string) {
      setState((prev: Record<string, string>) => ({ ...prev, [name]: newVal }));
    }
    return (
      <div
        style={{ display: "flex", flexFlow: "row nowrap", padding: "5px 0" }}
      >
        {levels.map((label, idx) => (
          <label
            // biome-ignore lint/suspicious/noArrayIndexKey: The index actually does matter here.
            key={idx}
            style={{ display: "block", textAlign: "center", flex: "1 1 0px" }}
            title={spying ? `${name}=${idx}` : undefined}
          >
            <input
              type="radio"
              checked={choice === `${idx}`}
              onChange={() => change(`${idx}`)}
            />
            <br />
            <span>
              {label}
              &nbsp;
            </span>
          </label>
        ))}
      </div>
    );
}

export const stringIsNontrivial = (x: (string | null)) => (x || "").trim().length > 0;

export const withValidation = (requiredInputs: string[], view: React.ReactNode) => {
  return {
    view,
    complete: (state: Record<string, string | null>) =>
      requiredInputs.every(name =>
        stringIsNontrivial(state[name])
      ),
  };
};

type NextBtnProps = {
  enabledFn?: (state: Record<string, string>) => boolean;
  disabled?: boolean;
  confirm?: boolean;
  advance: () => void;
  children?: React.ReactNode;
};

export const NextBtn = (props: NextBtnProps) => {
    const state = useAtomValue(inputStateAtom);
  let enabled: boolean;
  if (props.enabledFn) {
    enabled = props.enabledFn(state);
  } else {
    enabled = !props.disabled;
  }
  return (
    <button
      type="button"
      className={
        [
          "bg-white border border-solid rounded-md text-black cursor-pointer inline-block text-[1.1em] font-bold h-8 leading-8 px-12 text-center no-underline whitespace-nowrap border-[#9b4dca]",
          // Disabled state
          !enabled ? "text-gray-400 border-gray-400 cursor-not-allowed" : "hover:bg-violet-50 focus:ring-2 focus:ring-violet-300"
        ].join(' ')
      }
      onClick={() => {
        if (!props.confirm || window.confirm("Are you sure?")) {
          props.advance();
        }
      }}
      disabled={!enabled}
    >
      {props.children || (enabled ? "Next" : "Please answer all prompts above")}
    </button>
  );
};
