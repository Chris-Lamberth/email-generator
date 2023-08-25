// Helper function to normalize the brand text
function normalizeBrandText(content) {
	const regex = /\[\s*brand\s*\]/gi; // matches variations like [brand], [ brand ], [Brand], [Brand ], [ brand], [ Brand], etc.
	return content.replace(regex, '[Brand]');
 }
 
 // Listen for input events
 document.addEventListener('input', function(event) {
	const target = event.target;
 
	// Check if the target is an input or textarea
	if (target.tagName.toLowerCase() === 'input' || target.tagName.toLowerCase() === 'textarea') {
	  const value = target.value;
	  
	  // Normalize the brand text
	  target.value = normalizeBrandText(value);
	}
 });
 