"""Create the Kafka topics used by the SAP integration. Safe to run repeatedly.

    python create_topics.py            # create missing topics, retry until the broker is up
"""

from __future__ import annotations

import logging
import os
import time

from iems_kafka import ensure_topics, topic_specs

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("create_topics")


def main() -> None:
    attempts = int(os.environ.get("KAFKA_TOPIC_INIT_ATTEMPTS", "30"))
    for attempt in range(1, attempts + 1):
        try:
            created = ensure_topics()
            break
        except Exception as exc:
            if attempt == attempts:
                raise
            log.warning("Broker not ready (attempt %s/%s): %s", attempt, attempts, exc)
            time.sleep(2)
    for spec in topic_specs():
        state = "created" if spec.name in created else "exists"
        log.info("%-32s partitions=%-2s %s %s", spec.name, spec.partitions, state, spec.config or "")


if __name__ == "__main__":
    main()
