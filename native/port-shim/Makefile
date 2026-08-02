UNAME_S := $(shell uname -s)
CFLAGS := -O2 -fPIC -Wall -Wextra

ifeq ($(UNAME_S),Darwin)
  TARGET := huu-port-shim.dylib
  LDFLAGS := -dynamiclib
  LIBS :=
else
  TARGET := huu-port-shim.so
  LDFLAGS := -shared
  LIBS := -ldl -lpthread
endif

all: $(TARGET)

$(TARGET): port-shim.c
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ port-shim.c $(LIBS)

clean:
	rm -f huu-port-shim.so huu-port-shim.dylib

.PHONY: all clean
