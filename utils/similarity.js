(function() {
  const Similarity = {
    jaccard: function(str1, str2) {
      if (!str1 || !str2) return 0;
      
      const getWords = (str) => {
        return new Set(
          str.toLowerCase()
            .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "")
            .split(/\s+/)
            .filter(word => word.length > 0)
        );
      };

      const set1 = getWords(str1);
      const set2 = getWords(str2);

      if (set1.size === 0 && set2.size === 0) return 1.0;

      let intersectionSize = 0;
      for (const word of set1) {
        if (set2.has(word)) {
          intersectionSize++;
        }
      }

      const unionSize = set1.size + set2.size - intersectionSize;
      return unionSize > 0 ? intersectionSize / unionSize : 0.0;
    },

    averagePairwiseSimilarity: function(answersMap) {
      const answers = Object.values(answersMap).filter(s => typeof s === 'string' && s.trim().length > 0);
      if (answers.length <= 1) return 1.0; // If 0 or 1 answer, no divergence, similarity is trivially 1

      let totalSimilarity = 0;
      let count = 0;

      for (let i = 0; i < answers.length; i++) {
        for (let j = i + 1; j < answers.length; j++) {
          totalSimilarity += this.jaccard(answers[i], answers[j]);
          count++;
        }
      }

      return count > 0 ? totalSimilarity / count : 0.0;
    }
  };

  if (typeof self !== 'undefined') {
    self.Similarity = Similarity;
  }
})();
