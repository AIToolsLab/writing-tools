#!/bin/bash
# Need to provide Prolific ID as username.
# The mapping will look like:
#     Prolific ID -> username, Study ID -> STUDY_ID, Session ID -> SESSION_ID
for condition in n c e; do
    for scenario in roomDoubleBooking demoRescheduling substituteProduct; do
        url="https://study.thoughtful-ai.com/study?page=consent&condition=$condition&isProlific=true&scenario=$scenario"
        echo "$url"
    done
done
