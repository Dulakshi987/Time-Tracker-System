package com.service;

import com.entity.IssuePrint;
import com.repository.IssuePrintRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;

@Service
public class IssuePrintService {

    @Autowired
    private IssuePrintRepository repo;

    public IssuePrint save(IssuePrint ip) {
        ip.setStatus("CREATED");
        return repo.save(ip);
    }

    // START
    public IssuePrint startIssue(Long id) {

        IssuePrint issue = repo.findById(id).orElseThrow();

        issue.setStartTime(LocalDateTime.now());
        issue.setStatus("STARTED");

        return repo.save(issue);
    }

    // END + CALCULATE
    public IssuePrint endIssue(Long id) {

        IssuePrint issue = repo.findById(id).orElseThrow();

        LocalDateTime end = LocalDateTime.now();
        issue.setEndTime(end);

        Duration duration = Duration.between(issue.getStartTime(), end);
        issue.setDurationSeconds(duration.getSeconds());

        issue.setStatus("COMPLETED");

        return repo.save(issue);
    }
}