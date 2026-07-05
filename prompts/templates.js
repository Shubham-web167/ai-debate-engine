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

    getJudgePrompt: function(question, finalAnswersMap) {
      let answersText = '';
      for (const [platform, answer] of Object.entries(finalAnswersMap)) {
        if (answer) {
          answersText += `### Final Answer from ${platform.toUpperCase()}:\n${answer}\n\n`;
        }
      }
      return `You are acting as the Lead Synthesizer and Judge in a multi-agent AI debate.
The original question asked was:
"${question}"

Here are the final, critiqued answers proposed by each model:
${answersText}
Please review all the proposed answers carefully. Synthesize them into a single, cohesive, authoritative, and high-quality final response. Resolve any contradictions, select the most accurate points, and output the absolute best combined answer. The final output must be self-contained and ready for the user.`;
    }
  };

  if (typeof self !== 'undefined') {
    self.DebateTemplates = DebateTemplates;
  }
})();
