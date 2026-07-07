(function() {
  const DebateTemplates = {
    getCritiquePrompt: function(question, platform, myLastAnswer, otherAnswersMap) {
      let otherResponsesText = '';
      for (const [otherPlatform, answer] of Object.entries(otherAnswersMap)) {
        if (otherPlatform !== platform && answer) {
          otherResponsesText += `### Response from ${otherPlatform.toUpperCase()}:\n${answer}\n\n`;
        }
      }
      return `You are participating in a collaborative expert debate.
The original question was:
"${question}"

Your previous answer was:
"${myLastAnswer}"

Here are the answers provided by other expert AI models:
${otherResponsesText}
Please critique your own previous answer. Look for errors, omissions, inconsistencies, or areas where the other models offered superior reasoning.
Then, write a revised, fully updated, and improved version of your answer that incorporates the best elements of all responses. Make it complete and self-contained.`;
    },

    getJudgeAnalysisPrompt: function(question, finalAnswersMap) {
      let answersText = '';
      for (const [platform, answer] of Object.entries(finalAnswersMap)) {
        answersText += `\n### ${platform.toUpperCase()}:\n${answer}\n`;
      }
      return `You are the Analysis Engine in a multi-agent AI debate system. Do NOT write a final answer yet. Your only job right now is structured extraction and comparison.

The original question was: "${question}"

Here are the final answers from each model:
${answersText}
Produce ONLY the following, in this exact structure. Do not add commentary or recommendations. Keep it concise.

1. CLAIMS (Max 10 core claims. Merge duplicates. Ignore minor observations.)
List each unique reasoning claim that materially affects the recommendation.

2. AGREEMENT MATRIX
For each claim, show which models supported it: Claim | ModelA | ModelB (use ✔/✘). 
Only include meaningful claims. If all models agree on a claim, mark it once. If no meaningful contradiction exists, explicitly output "No meaningful contradiction detected."

3. CONTRADICTIONS
List claims where models directly disagreed/conflicted. Briefly state why. Do not invent disagreements.

4. HIDDEN ASSUMPTIONS
List only assumptions that materially influence the recommendation but were treated as fact.

5. UNKNOWNS
List only missing information that could realistically change the final recommendation.

6. UNIQUE STRUCTURAL CONTRIBUTIONS
Preserve any better reasoning framework, IF/THEN logic, decision tree, comparison table, or scoring rubric contributed by any model. Do not discard structural improvements.

Output only these 6 sections, nothing else.`;
    },

    getJudgeSynthesisPrompt: function(question, analysisText) {
      return `You are the Lead Synthesizer in a multi-agent AI debate system. You have completed a structured analysis (below). Now write the final answer.

Original question: "${question}"

Analysis from Pass 1:
${analysisText}

Write the final answer using this structure:

**Recommendation**
State the clear recommendation.

**Why**
Give the reasoning from the strongest claims. Do not repeat duplicate points. Preserve any unique structural framework (IF/THEN, tables) from the analysis.
IMPORTANT: Agreement != Truth. If multiple models repeat the same unsupported claim, treat it as one unsupported claim.

**Assumptions**
List the key assumptions this recommendation depends on.

**Unknowns**
List what isn't known that could matter.

**Self-Critique**
Argue against your own recommendation. What is the single strongest objection? If it invalidates the recommendation, change it above. Otherwise briefly explain why it still stands.

**What Would Change This Answer**
State specifically what new information would flip the recommendation.

**Confidence**
State High, Medium, or Low ONLY, followed by a one-sentence explanation. Do not use percentages.

Write this as a complete, self-contained answer. Do not mention "Pass 1" or "analysis".`;
    }
  };

  if (typeof self !== 'undefined') {
    self.DebateTemplates = DebateTemplates;
  }
})();
