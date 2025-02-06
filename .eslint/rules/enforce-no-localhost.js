module.exports = {
    meta: {
      type: "problem",
      docs: {
        description:
          "Prevent committing FRENGLISH_BACKEND_URL set to a localhost URL",
        category: "Possible Errors",
        recommended: false,
      },
      schema: [],
    },
    create(context) {
      // Helper to check a given value for a disallowed localhost URL.
      function checkForLocalhost(node, value) {
        if (typeof value === "string" && value.includes("http://localhost")) {
          context.report({
            node,
            message:
              "FRENGLISH_BACKEND_URL should not be set to a localhost URL.",
          })
        }
      }
  
      return {
        // Look for variable declarations (including exported ones)
        VariableDeclarator(node) {
          // Check if the variable's name is exactly "FRENGLISH_BACKEND_URL"
          if (node.id && node.id.name === "FRENGLISH_BACKEND_URL") {
            const init = node.init
            if (!init) return // no initializer; nothing to check
  
            // Handle string literals
            if (init.type === "Literal") {
              checkForLocalhost(init, init.value)
            }
            // Handle template literals (assuming no embedded expressions)
            else if (init.type === "TemplateLiteral") {
              // Combine all the static parts of the template literal
              const fullText = init.quasis.map((q) => q.value.raw).join("")
              checkForLocalhost(init, fullText)
            }
          }
        },
      }
    },
  }
  