# Running

See instructions in `backend/README.md` and `frontend/README.md`. Both need to be running for the add-in to work.

Note: the user study code is in `experiment`, which is separate from the add-in code in `backend` and `frontend`.

Note: the custom LLM backend has moved to https://github.com/AIToolsLab/writing-prototypes.

# Installing the add-in in Microsoft Word (Web)

- Open a Microsoft word document on web
- Navigate to insert tab
- Click add-ins button, upload my add-in
- Drag add-in/manifest.xml into the upload bar
- Click upload

If you can't find the Add-ins tab, look instead on the File menu for "Get Add-ins" or something like that, then click Manage Add-ins.

# Running visual regression tests

The visual regression tests capture screenshots and ensure UI consistency of the application. See [VISUAL_REGRESSION.md](VISUAL_REGRESSION.md) for detailed instructions on running tests and updating baseline images.

# Acknowledgment

This project is developed by the [Thoughtful AI Lab](https://thoughtful-ai.com/) at Calvin University, led by Prof. Ken Arnold.

This material is based upon work supported by the U.S. National Science Foundation under Grant No. [2246145](https://www.nsf.gov/awardsearch/show-award/?AWD_ID=2246145) (CRII: HCC: Interactive Natural Language Technology for Supporting Writers in Structuring and Revising Documents). Any opinions, findings, and conclusions or recommendations expressed in this material are those of the author(s) and do not necessarily reflect the views of the National Science Foundation.
