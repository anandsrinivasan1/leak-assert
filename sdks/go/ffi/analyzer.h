#ifndef LEAK_ASSERT_FFI_H
#define LEAK_ASSERT_FFI_H

#include <stdint.h>

/**
 * Analyse a JSON array of samples against a JSON array of assertions.
 * Returns a JSON string of LeakTestResult.
 * The returned pointer MUST be freed with la_free_string().
 */
char* la_analyze(const char* samples_json, const char* assertions_json);

/**
 * Compute the OLS slope of heap_used over iterations.
 * Returns the result as a JSON number string.
 * The returned pointer MUST be freed with la_free_string().
 */
char* la_slope(const char* samples_json);

/**
 * Free a string returned by la_analyze or la_slope.
 */
void la_free_string(char* ptr);

#endif /* LEAK_ASSERT_FFI_H */
