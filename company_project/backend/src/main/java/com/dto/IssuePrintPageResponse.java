// src/main/java/com/dto/IssuePrintPageResponse.java
package com.dto;

import com.entity.Issue;
import java.util.List;

public class IssuePrintPageResponse {

    private List<Issue> content;
    private int page;
    private int size;
    private long totalElements;
    private int totalPages;
    private Stats stats;

    public IssuePrintPageResponse(List<Issue> content, int page, int size,
                                   long totalElements, int totalPages, Stats stats) {
        this.content = content;
        this.page = page;
        this.size = size;
        this.totalElements = totalElements;
        this.totalPages = totalPages;
        this.stats = stats;
    }

    public List<Issue> getContent() { return content; }
    public int getPage() { return page; }
    public int getSize() { return size; }
    public long getTotalElements() { return totalElements; }
    public int getTotalPages() { return totalPages; }
    public Stats getStats() { return stats; }

    public static class Stats {
        public long total;
        public long pending;
        public long inProgress;
        public long onHold;
        public long completed;
        public long handedOver; // 0 for Print Portal callers using the 5-arg constructor

        public Stats(long total, long pending, long inProgress, long onHold, long completed) {
            this(total, pending, inProgress, onHold, completed, 0);
        }

        public Stats(long total, long pending, long inProgress, long onHold, long completed, long handedOver) {
            this.total = total;
            this.pending = pending;
            this.inProgress = inProgress;
            this.onHold = onHold;
            this.completed = completed;
            this.handedOver = handedOver;
        }
    }
}