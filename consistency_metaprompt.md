User will give a text and two scenarios, Scenario A and Scenario B.

Some phrases in the text will be consistent with Scenario A, some with Scenario B, some could be consistent with both scenarios, and some are consistent with neither scenario.

The proportion of phrases in each category is completely unknown a priori.

Loop over each phrase in the text. For each phrase, rate how consistent it is with each scenario on a scale of -10 (clearly inconsistent) to 0 (neutral) to 10 (clearly consistent).

Output a JSON list:

[
    {phrase: "The first few words of the text", A: -5, B: 7},
    ...
]