// From https://github.com/kcarnold/textrec/blob/master/src/frontend/src/SurveyViews.js

import React from "react";
import { ControlledInput, OptionsInput, NextBtn, LikertInput, inputStateAtom } from "./ControlledInput";
import { useAtomValue } from "jotai";

function classNames(...args: (string | null | undefined)[]) {
  return args.filter(Boolean).join(" ");
}

export function likert(name: string, text: (string | JSX.Element), degrees: number, labels: [string, string]) {
  const options: string[] = Array(degrees).fill("");
  options[0] = labels[0];
  options[degrees - 1] = labels[1];
  return {
    text,
    name,
    responseType: "likert",
    options,
  };
}

export const agreeLikert = (name: string, prompt: string, n = 7) =>
  likert(name, prompt, n, ["Strongly disagree", "Strongly agree"]);

function TextResponse({ name, question }: { name: string, question: any }) {
  return <ControlledInput name={name} {...(question.flags || {})} />;
}

export const OptionsResponse = ({
    name,
    question,
    spying,
  }: {
    name: string;
    question: any;
    spying: boolean;
  }) => {
    return <OptionsInput
      name={name}
      options={question.options}
      spying={spying}
    />;
  }

export const LikertResponse = ({
  name,
  question,
  spying,
  }: {
    name: string;
    question: any;
    spying: boolean;
  }) => {
    return <LikertInput name={name} levels={question.levels} spying={spying} />;
  }

const responseTypes: Record<string, any> = {
  text: TextResponse,
  options: OptionsResponse,
  likert: LikertResponse,
};

const allQuestions: Record<string, any> = {};

/* 
export const ColumnDictionary = inject("state")(() => (
  <div style={{ fontSize: "10px" }}>
    {Array.from(Object.entries(allQuestions)).length} survey questions:
    <table>
      <thead>
        <tr>
          <td>Column</td>
          <td>Type</td>
          <td>Options</td>
          <td>Text</td>
        </tr>
      </thead>
      <tbody>
        {Array.from(Object.entries(allQuestions)).map(
          ([responseVarName, question]) => (
            <tr key={responseVarName}>
              <td>{responseVarName}</td>
              <td>{question.responseType}</td>
              <td>{(question.options || []).join(", ")}</td>
              <td>{question.text}</td>
            </tr>
          )
        )}
      </tbody>
    </table>
  </div>
));

*/

interface QuestionType {
  text: string | JSX.Element;
  name: string;
  responseType: string;
  options?: string[];
  flags?: Record<string, any>;
};

const Question = ({ basename, question }: {
  basename: string;
  question: QuestionType
}) => {
  const state = useAtomValue(inputStateAtom);
    let responseType = null;
    let responseVarName = null;
    let responseClass = null;
    if (question.responseType) {
      console.assert(question.responseType in responseTypes);
      responseType = responseTypes[question.responseType];
      responseVarName = `${basename}-${question.name}`;
      responseClass =
        state[responseVarName] !== undefined
          ? "complete"
          : "missing";
      allQuestions[responseVarName] = question;
    } else {
      console.assert(!!question.text);
    }
    return (
      <div
        className={classNames("Question", responseClass)}
        style={{
          margin: "5px",
          borderTop: "1px solid #aaa",
          padding: "5px",
        }}
      >
        <div className="QText">{question.text}</div>
        {responseType ? (
          React.createElement(responseType, {
            question,
            name: responseVarName,
          })
        ) : null}
      </div>
    );
  };

export const surveyBody = (basename: string, questions: any[]) =>
  questions.map((question, idx) => (
    <Question
      key={question.name || idx}
      basename={basename}
      question={question}
    />
  ));

export const allQuestionsAnswered = (basename: string, questions: any[]) => (state: Record<string, any>) =>
  questions.every(
    (question: any) =>
      question.type === "text" ||
      !question.responseType ||
      question.optional ||
      state[basename + "-" + question.name] !== undefined
  );

interface SurveyProps {
  title: string;
  basename: string;
  questions: any[];
  onAdvance: (surveyData: Record<string, string>) => void;
}

export const Survey = ({ title, basename, questions, onAdvance }: SurveyProps) => {
  const state = useAtomValue(inputStateAtom);
  const surveyData = questions.reduce((acc, question) => {
      const responseVarName = `${basename}-${question.name}`;
      if (question.responseType) {
        acc[responseVarName] = state[responseVarName];
      }
      return acc;
    }, {} as Record<string, string>);

  const handleAdvance = () => {
    onAdvance(surveyData);
  };

  return (
    <div className="Survey">
      <h1>{title}</h1>
      {surveyBody(basename, questions)}
      <NextBtn enabledFn={allQuestionsAnswered(basename, questions)} advance={handleAdvance} />
    </div>
  );
};

export function surveyView(props: SurveyProps) {
  return () => React.createElement(Survey, props);
}