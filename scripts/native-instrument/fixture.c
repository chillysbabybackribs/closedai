#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <unistd.h>

/* Disposable, cooperative target. No system-wide ptrace policy changes. */
__attribute__((noinline, visibility("default"))) int fixture_add(int value) {
  return value + 7;
}

int main(void) {
  char line[128];
  setvbuf(stdout, NULL, _IONBF, 0);
  printf("ready %d\n", getpid());
  while (fgets(line, sizeof(line), stdin)) {
    if (strncmp(line, "authorize ", 10) == 0) {
      int result = prctl(PR_SET_PTRACER, strtol(line + 10, NULL, 10), 0, 0, 0);
      printf("authorized %d\n", result);
    } else if (strncmp(line, "exit", 4) == 0) {
      break;
    } else {
      printf("value %d\n", fixture_add(atoi(line)));
    }
  }
  return 0;
}
